import {describe, expect, it} from 'vitest';
import {buildAirportAliases, chainJourneys, daysBetween, detectAwaySpans, fallbackSpans, flightDestination, isFlightLike, mergeSpans, resolveAirport, travelAdjacency, type AwaySpan} from './away';
import {normalizeGoogleEvent, type GoogleEventResource} from './normalize';
import {addCalendarDays} from './range';
import type {CalendarEvent} from './types';

// Independently authored parser cases. QAA/QBB/QCC/QDD are arbitrary test tokens,
// not real airport geography; every calendar ID and narrative is fictional.
let serial = 0;
function event(raw: GoogleEventResource, primary = true, zone = 'UTC'): CalendarEvent {
  const first = (raw.start?.date || raw.start?.dateTime || '').slice(0, 10);
  const last = (raw.end?.date || raw.end?.dateTime || '').slice(0, 10);
  const value = normalizeGoogleEvent({id: `synthetic-case-${++serial}`, status: 'confirmed', ...raw}, {calendarId: 'fictional@example.invalid', name: 'Invented calendar', primary}, {startDate: addCalendarDays(first, -1), endDate: addCalendarDays(last, 1), timeZone: zone});
  if (!value) throw new Error('Invalid invented fixture');
  return value;
}
function flight(date: string, from: string | null, to: string, hour = 10) {
  return event({summary: `Flight to ${to}`, location: from || '', transparency: 'transparent', start: {dateTime: `${date}T${String(hour).padStart(2,'0')}:00:00Z`}, end: {dateTime: `${date}T${String(hour + 1).padStart(2,'0')}:00:00Z`}});
}
function block(first: string, last: string, title: string, kind = 'default', primary = true) {
  return event({summary: title, eventType: kind, start: {date: first}, end: {date: addCalendarDays(last, 1)}}, primary);
}
function chain(events: CalendarEvent[], max?: number) {return chainJourneys(events, buildAirportAliases(events), max);}
function span(first: string, last: string, label = 'Workshop', confidence: 'high' | 'low' = 'high'): AwaySpan {
  return {startDate: first, endDate: last, label, confidence, source: 'multi-day'};
}
function expected(first: string, last: string, code?: string, confidence: 'high' | 'low' = code ? 'high' : 'low'): AwaySpan {
  return {startDate: first, endDate: last, label: code ? `Away (${code})` : 'Travel day', source: 'flight-chain', confidence};
}

describe('civil-day and synthetic airport parsing', () => {
  it.each([['2035-03-10','2035-03-12',2],['2035-11-03','2035-11-05',2],['2035-12-31','2036-01-02',2],['2036-01-02','2035-12-31',-2],['2036-02-29','2036-02-29',0]] as const)('counts %s to %s', (a,b,n) => expect(daysBetween(a,b)).toBe(n));
  it('keeps the prevalidated input contract explicit', () => {expect(daysBetween('nonsense','2035-01-01')).toBeNaN(); expect(daysBetween('2035-02-30','2035-03-02')).toBe(0);});
  it('learns structured aliases and ignores unsupported location shapes', () => {
    const aliases = buildAirportAliases([flight('2035-01-01','Alder Quay Intl QAA','QBB'), flight('2035-01-02','Birch Haven (QBB)','QAA')]);
    expect(aliases.get('alder quay')).toBe('QAA'); expect(aliases.has('birch haven')).toBe(false);
    expect(resolveAirport('Alder Quay',aliases)).toBe('QAA'); expect(resolveAirport('QCC',aliases)).toBe('QCC');
    expect(resolveAirport('Drift Point',aliases)).toBe('drift point'); expect(resolveAirport('  ',aliases)).toBeNull();
  });
  it.each([['Flight: QAA to QBB to QCC','QCC'],['Flight to Copper Reach (TEST) upgrade to sky lounge','Copper Reach'],['Flight to Élan Cove','Élan Cove'],['Studio planning',null],['Flight',null]] as const)('parses %s', (title,destination) => expect(flightDestination(title)).toBe(destination));
  it('qualifies only timed sub-day flight notices, independently of blocking', () => {
    const f = flight('2035-01-03','QAA','QBB'); expect(f.blocking.countsAsConflict).toBe(false); expect(isFlightLike(f)).toBe(true);
    expect(isFlightLike({...f,durationMinutes:1439})).toBe(true); expect(isFlightLike({...f,durationMinutes:1440})).toBe(false);
    expect(isFlightLike({...f,durationMinutes:null})).toBe(true); expect(isFlightLike(block('2035-01-03','2035-01-04','Flight to QBB'))).toBe(false);
    expect(isFlightLike({...f,title:'Laboratory appointment'})).toBe(false);
  });
});

describe('independent journey topologies', () => {
  it('closes a robotics exhibition journey', () => {expect(chain([flight('2035-02-02','QAA','QBB'),flight('2035-02-05','QBB','QAA')])).toEqual([expected('2035-02-02','2035-02-05','QBB')]);});
  it('orders a same-day seed exchange by actual departure time', () => {expect(chain([flight('2035-02-09','QBB','QAA',16),flight('2035-02-09','QAA','QBB')])).toEqual([expected('2035-02-09','2035-02-09','QBB')]);});
  it('does not invent the time between unpaired origin-free notices', () => {expect(chain([flight('2035-03-01',null,'QBB'),flight('2035-03-06',null,'QAA')])).toEqual([expected('2035-03-01','2035-03-01'),expected('2035-03-06','2035-03-06')]);});
  it('keeps a partially documented visit separate from a later closed observatory visit', () => {
    expect(chain([flight('2035-03-12',null,'QBB'),flight('2035-03-14','QBB','QAA'),flight('2035-03-21','QAA','QCC'),flight('2035-03-23','QCC','QAA')])).toEqual([expected('2035-03-12','2035-03-14','QBB','low'),expected('2035-03-21','2035-03-23','QCC')]);
  });
  it('does not bridge from a scan that opens on a return leg', () => {expect(chain([flight('2035-04-01','QBB','QAA'),flight('2035-04-05','QAA','QCC'),flight('2035-04-07','QCC','QAA')])).toEqual([expected('2035-04-01','2035-04-01'),expected('2035-04-05','2035-04-07','QCC')]);});
  it('uses a three-day open-chain boundary', () => {
    expect(chain([flight('2035-04-10','QAA','QBB'),flight('2035-04-13','QBB','QCC')])).toEqual([expected('2035-04-10','2035-04-13','QBB','low')]);
    expect(chain([flight('2035-04-10','QAA','QBB'),flight('2035-04-14','QBB','QCC')])).toEqual([expected('2035-04-10','2035-04-10'),expected('2035-04-14','2035-04-14')]);
  });
  it('uses a seven-day closing boundary and respects an explicit lower cap', () => {
    expect(chain([flight('2035-05-01','QAA','QBB'),flight('2035-05-08','QBB','QAA')])).toEqual([expected('2035-05-01','2035-05-08','QBB')]);
    expect(chain([flight('2035-05-01','QAA','QBB'),flight('2035-05-09','QBB','QAA')])).toHaveLength(2);
    expect(chain([flight('2035-05-01','QAA','QBB'),flight('2035-05-05','QBB','QAA')],3)).toHaveLength(2);
  });
  it('separates closed visits even with a short intervening gap', () => {expect(chain([flight('2035-06-01','QAA','QBB'),flight('2035-06-03','QBB','QAA'),flight('2035-06-06','QAA','QCC'),flight('2035-06-08','QCC','QAA')])).toEqual([expected('2035-06-01','2035-06-03','QBB'),expected('2035-06-06','2035-06-08','QCC')]);});
  it('labels a three-leg touring triangle with its longest stay, regardless of input order', () => {
    const legs=[flight('2035-07-01','QAA','QBB'),flight('2035-07-02','QBB','QCC'),flight('2035-07-04','QCC','QAA')];
    expect(chain(legs)).toEqual([expected('2035-07-01','2035-07-04','QCC')]); expect(chain([legs[2],legs[0],legs[1]])).toEqual(chain(legs));
  });
  it('includes both occupied days of an overnight return', () => {
    const overnight=event({summary:'Flight to QAA',location:'QBB',transparency:'transparent',start:{dateTime:'2035-08-04T22:00:00Z'},end:{dateTime:'2035-08-05T06:00:00Z'}});
    expect(chain([flight('2035-08-02','QAA','QBB'),overnight])).toEqual([expected('2035-08-02','2035-08-05','QBB')]);
  });
  it('never infers a home from frequent destination mentions', () => {
    const spans=chain([flight('2035-09-01','QAA','QBB'),flight('2035-09-10','QAA','QBB'),flight('2035-09-20','QCC','QBB')]);
    expect(spans).toEqual(['01','10','20'].map(d=>expected(`2035-09-${d}`,`2035-09-${d}`)));
    expect(travelAdjacency({start:'2035-09-28',end:'2035-09-30'},spans)).toBeNull();
  });
  it('does not chain overlapping inconsistent legs but merges the occupied evidence', () => {
    const overnight=event({summary:'Flight to QBB',location:'QAA',start:{dateTime:'2035-10-01T22:00:00Z'},end:{dateTime:'2035-10-02T04:00:00Z'}});
    const returning=event({summary:'Flight to QAA',location:'QBB',start:{dateTime:'2035-10-01T23:00:00Z'},end:{dateTime:'2035-10-01T23:45:00Z'}});
    expect(chain([overnight,returning])).toHaveLength(2);expect(detectAwaySpans([overnight,returning])).toEqual([expected('2035-10-01','2035-10-02')]);
  });
  it('ignores canceled, destination-free and empty-date evidence', () => {
    const a=flight('2035-11-01','QAA','QBB'),b=flight('2035-11-03','QBB','QAA');
    expect(detectAwaySpans([{...a,status:'cancelled'},{...b,status:'cancelled'},{...a,title:'Studio appointment'},{...a,occupiedDates:[]},{...b,title:'Flight details'}])).toEqual([]);
  });
  it.each([['2035-03-10T10:00:00-05:00','2035-03-12T10:00:00-04:00'],['2035-11-03T10:00:00-04:00','2035-11-05T10:00:00-05:00']])('normalizes DST-boundary legs %s', (depart,back) => {
    const make=(start:string,from:string,to:string)=>event({summary:`Flight to ${to}`,location:from,start:{dateTime:start},end:{dateTime:new Date(Date.parse(start)+3600000).toISOString()}},true,'America/New_York');
    expect(chain([make(depart,'QAA','QBB'),make(back,'QBB','QAA')])).toEqual([expected(depart.slice(0,10),back.slice(0,10),'QBB')]);
  });
});

describe('explicit calendar evidence and confidence', () => {
  it('limits fallback evidence to primary structured or multiday all-day events', () => {
    const events=[block('2035-11-10','2035-11-10','Quiet day','outOfOffice'),block('2035-11-12','2035-11-14','Studio closure','outOfOffice'),block('2035-11-20','2035-11-22','Observatory road trip'),block('2035-11-24','2035-11-26','Shared road trip','default',false),block('2035-11-27','2035-11-27','Road trip planning')];
    const spans=fallbackSpans(events);expect(spans).toHaveLength(3);expect(spans.map(x=>[x.confidence,x.source])).toEqual([['low','out-of-office'],['high','out-of-office'],['high','multi-day']]);
    expect(events[2].interval).toEqual({kind:'all-day',startDate:'2035-11-20',endDateExclusive:'2035-11-23'});
    expect(fallbackSpans([event({summary:'Road trip planning',start:{dateTime:'2035-11-25T23:00:00Z'},end:{dateTime:'2035-11-26T01:00:00Z'}})])).toEqual([]);
  });
  it('preserves containing confidence, degrades extensions and leaves a clear-day gap', () => {
    const workshop=span('2035-12-01','2035-12-05'),fragment=span('2035-12-02','2035-12-02','Fragment','low');
    expect(mergeSpans([workshop,fragment])).toEqual([workshop]);
    const input=[workshop,span('2035-12-04','2035-12-07','Transit','low'),span('2035-12-08','2035-12-09','Exhibition'),span('2035-12-11','2035-12-11','Reading')];
    expect(mergeSpans(input)).toEqual([span('2035-12-01','2035-12-09','Workshop','low'),input[3]]);expect(mergeSpans(input.slice().reverse())).toEqual(mergeSpans(input));
  });
  it('keeps transparent flights as travel while a contained PTO block adds no duplicate', () => {
    const legs=[flight('2036-02-04','QAA','QDD'),flight('2036-02-06','QDD','QAA')];
    expect(legs.every(x=>!x.blocking.countsAsConflict)).toBe(true);
    expect(detectAwaySpans([...legs,block('2036-02-05','2036-02-06','PTO')])).toEqual([expected('2036-02-04','2036-02-06','QDD')]);
  });
});

describe('rest-day advice boundaries', () => {
  const window={start:'2036-01-10',end:'2036-01-12'};
  it.each([[9,0,'severe'],[8,1,'high'],[7,2,'moderate'],[6,3,'moderate'],[5,4,'low'],[3,6,'low']] as const)('scores a span ending January%d', (day,gap,severity) => {
    const date=`2036-01-${String(day).padStart(2,'0')}`;expect(travelAdjacency(window,[span(date,date)])).toMatchObject({severity,gapDays:gap,direction:'before'});
  });
  it('distinguishes overlap, the following day and irrelevant evidence', () => {
    expect(travelAdjacency(window,[span('2036-01-12','2036-01-12')])).toMatchObject({severity:'overlapping',gapDays:0});
    expect(travelAdjacency(window,[span('2036-01-13','2036-01-13')])).toMatchObject({severity:'severe',gapDays:0,direction:'after'});
    expect(travelAdjacency(window,[span('2036-01-02','2036-01-02')])).toBeNull(); expect(travelAdjacency(window,[])).toBeNull();
  });
  it('resolves priority by direction, proximity and confidence', () => {
    const before=span('2036-01-09','2036-01-09'),after=span('2036-01-13','2036-01-13');
    expect(travelAdjacency(window,[after,before])?.span).toEqual(before);
    expect(travelAdjacency(window,[span('2036-01-06','2036-01-06'),span('2036-01-07','2036-01-07')])?.gapDays).toBe(2);
    expect(travelAdjacency(window,[{...before,confidence:'low'},before])?.span.confidence).toBe('high');
  });
});
