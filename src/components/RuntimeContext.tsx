'use client';
import {createContext,useContext} from 'react';
export type PublicRuntime = {mode:'demo'|'production';notificationMode:'preview'|'email'|'disabled'};
export const RuntimeContext = createContext<PublicRuntime>({mode:'production',notificationMode:'email'});
export function useRuntime(){return useContext(RuntimeContext);}
