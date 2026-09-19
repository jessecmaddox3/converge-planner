"use client";
import {SessionProvider, useSession} from "next-auth/react";
import type {Session} from "next-auth";
import {RuntimeContext,type PublicRuntime} from "./RuntimeContext";

function IdentityBoundary({children,actor}:{children:React.ReactNode;actor:string}) {
  const {data,status}=useSession();
  if (status !== 'loading' && (data?.user?.actorId || 'anonymous') !== actor) return <main className="demo-guide"><h1>Your account changed</h1><p>This page was opened under a different account. Reload it to continue with the current account.</p><button onClick={()=>window.location.reload()}>Reload this page</button></main>;
  return children;
}
export default function Providers({children,runtime,session}:{children:React.ReactNode;runtime:PublicRuntime;session:Session|null}){
  return <RuntimeContext.Provider value={runtime}><SessionProvider session={session}><IdentityBoundary actor={session?.user?.actorId || 'anonymous'}>{children}</IdentityBoundary></SessionProvider></RuntimeContext.Provider>;
}
