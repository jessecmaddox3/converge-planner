import type {GoogleEventResource} from '../calendar/normalize';
import type {CalendarSource} from '../calendar/types';
import type {GoogleEventRange, PaginatedResult} from '../calendar/google';
import {demoPeople} from './people';

function personFromToken(token: string) {
  const person = demoPeople.find(p => token === 'local-fixture:' + p.id);
  if (!person) throw new Error('A local fictional calendar identity is required.');
  return person;
}
export function fixtureCalendars(token: string): PaginatedResult<CalendarSource> {
  const person = personFromToken(token);
  return {items: [
    {calendarId: `${person.id}:studio`, name: 'Studio and community', color: '#55755C', primary: true},
    {calendarId: `${person.id}:learning`, name: 'Classes and quiet time', color: '#AA784E', primary: false},
    {calendarId: `${person.id}:unavailable`, name: 'Unavailable sample (shows partial coverage)', color: '#8C8694', primary: false},
  ], truncated: false, pageCount: 1};
}

/** Deterministic independent fiction for any chosen year; no copied calendar shape. */
export function fixtureEvents(token: string, calendarId: string, range: GoogleEventRange): PaginatedResult<GoogleEventResource> {
  const person = personFromToken(token);
  if (!fixtureCalendars(token).items.some(c => c.calendarId === calendarId)) throw new Error('Calendar does not belong to this demo persona.');
  if (calendarId.endsWith(':unavailable')) throw new Error('Demonstration of an unavailable calendar');
  const first = new Date(range.timeMin), last = new Date(range.timeMax || range.timeMin);
  if (!Number.isFinite(first.getTime()) || !Number.isFinite(last.getTime()) || last.getTime() - first.getTime() > 370 * 86400000) throw new Error('Invalid fixture range');
  const personIndex = demoPeople.findIndex(p => p.id === person.id), items: GoogleEventResource[] = [];
  for (const day = new Date(first); day <= last; day.setUTCDate(day.getUTCDate() + 1)) {
    const date = day.toISOString().slice(0, 10), number = day.getUTCDate(), weekday = day.getUTCDay();
    const add = (suffix: string, summary: string, fields: Partial<GoogleEventResource> = {}) => items.push({id: `${calendarId}:${date}:${suffix}`, iCalUID: `${calendarId}:${date}:${suffix}@example.invalid`, summary, status: 'confirmed', start: {dateTime: `${date}T15:00:00Z`}, end: {dateTime: `${date}T16:30:00Z`}, ...fields});
    if (calendarId.endsWith(':learning')) {
      if (weekday === (personIndex + 2) % 7) add('class', 'Printmaking studio', {eventType: 'focusTime'});
      continue;
    }
    if (weekday === (personIndex + 6) % 7 && number < 24) add('shift', ['Seed library shift','Robotics exhibition','Observatory workshop','Community theater setup'][personIndex]);
    if (number === 8 + personIndex) add('outbound', 'Flight to QBB', {location: 'Alder Quay QAA', transparency: 'transparent'});
    if (number === 10 + personIndex) add('return', 'Flight to QAA', {location: 'Birch Haven QBB', transparency: 'transparent'});
    if (number === 19 + personIndex) {
      const end = new Date(day); end.setUTCDate(end.getUTCDate() + 2);
      add('quiet', 'Out of office: creative workshop', {eventType: 'outOfOffice', start: {date}, end: {date: end.toISOString().slice(0,10)}});
    }
  }
  return {items, truncated: false, pageCount: 1};
}
