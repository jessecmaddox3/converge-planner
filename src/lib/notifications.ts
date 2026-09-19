import {isDemo} from './runtime/config';
import {localStore} from './storage';
import type {NotificationClaim} from './store';
import type {confirmationEmail} from './confirmation-email';
import nodemailer from 'nodemailer';

export type NotificationMode = 'preview' | 'email' | 'disabled';
export function notificationMode(): NotificationMode {
  if (isDemo()) return 'preview';
  return (process.env.SMTP_HOST && process.env.CONVERGE_MAIL_FROM) || (process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD) ? 'email' : 'disabled';
}
type Message = ReturnType<typeof confirmationEmail> & {to: string; from: string; messageId: string};

export function notificationTransport() {
  if (isDemo()) return {
    from: 'Converge demo <preview@example.invalid>',
    async sendMail(message: Message, claim: NotificationClaim) {
      const {db} = await localStore();
      // The record is durable before reporting acceptance. A later retry may create
      // another attempt, honestly matching the production at-least-once contract.
      await db.query('INSERT INTO public.converge_preview_outbox(trip_id,confirmation_version,response_public_id,lease_token,message) VALUES($1,$2,$3,$4,$5::jsonb) ON CONFLICT(lease_token) DO NOTHING', [claim.tripId,claim.confirmationVersion,claim.responsePublicId,claim.leaseToken,JSON.stringify(message)]);
    },
    close() {},
  };
  if (notificationMode() === 'disabled') return null;
  const sender = process.env.CONVERGE_MAIL_FROM || `Converge <${process.env.GMAIL_USER}>`;
  if (/[\r\n]/.test(sender)) throw new Error('Invalid mail sender.');
  const common = {pool: true, maxConnections: 3, connectionTimeout: 5000, greetingTimeout: 5000, socketTimeout: 10000, disableFileAccess: true, disableUrlAccess: true};
  const port = Number(process.env.SMTP_PORT || '587');
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid SMTP port.');
  const transport = process.env.SMTP_HOST ? nodemailer.createTransport({...common,host: process.env.SMTP_HOST,port,secure: process.env.SMTP_SECURE === 'yes',requireTLS: process.env.SMTP_SECURE !== 'yes',...(process.env.SMTP_USER ? {auth: {user: process.env.SMTP_USER,pass: process.env.SMTP_PASSWORD}} : {})}) : nodemailer.createTransport({...common,service:'gmail',auth:{user:process.env.GMAIL_USER,pass:process.env.GMAIL_APP_PASSWORD}});
  return {from: sender, async sendMail(message: Message, _claim: NotificationClaim) {await transport.sendMail(message);}, close() {transport.close();}};
}
