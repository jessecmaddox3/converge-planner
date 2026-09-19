// @vitest-environment jsdom
import {afterEach, expect, it, vi} from 'vitest';
import {cleanup, render, screen, waitFor} from '@testing-library/react';
const state=vi.hoisted(()=>({actor:'account:quinn'}));
vi.mock('@/components/auth-client',()=>({useSession:()=>({status:'authenticated',data:{user:{actorId:state.actor}}})}));
import MyTrips from './MyTrips';
afterEach(()=>{cleanup();vi.unstubAllGlobals();state.actor='account:quinn';});
const open={id:'one',name:'Open plan',startDate:'2038-04-01',endDate:'2038-04-30',duration:3,durationPreset:'weekend',status:'collecting',confirmedDate:null,confirmationVersion:0,createdAt:'2038-01-01T00:00:00Z',role:'organizer'};
it('shows the whole search range while collecting and the chosen date after confirmation',async()=>{
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:true,json:async()=>({trips:[open,{...open,id:'two',name:'Chosen plan',status:'confirmed',confirmedDate:'2038-04-16'}]})}));
 render(<MyTrips/>);
 expect((await screen.findByRole('link',{name:/Open plan/})).textContent).toContain('Apr 1 to Apr 30');
 expect(screen.getByRole('link',{name:/Chosen plan/}).textContent).toContain('Apr 16 to Apr 18');
});
it('refetches the private trip list when the authenticated account changes',async()=>{
 const fetcher=vi.fn().mockResolvedValueOnce({ok:true,json:async()=>({trips:[open]})}).mockResolvedValueOnce({ok:true,json:async()=>({trips:[{...open,id:'other',name:'Second account plan'}]})});
 vi.stubGlobal('fetch',fetcher);const view=render(<MyTrips/>);await screen.findByText('Open plan');
 state.actor='account:reed';view.rerender(<MyTrips/>);
 await waitFor(()=>expect(fetcher).toHaveBeenCalledTimes(2));
 await screen.findByText('Second account plan');expect(screen.queryByText('Open plan')).toBeNull();
});
