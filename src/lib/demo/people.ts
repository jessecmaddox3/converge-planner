// Entirely invented personas. These labels are only for a loopback-only demo.
export const demoPeople = [
  {id: 'quinn', name: 'Quinn Vale', email: 'quinn@example.invalid', role: 'Organizer'},
  {id: 'reed', name: 'Reed North', email: 'reed@example.invalid', role: 'Invitee'},
  {id: 'morgan', name: 'Morgan Lake', email: 'morgan@example.invalid', role: 'Invitee'},
  {id: 'taylor', name: 'Taylor Finch', email: 'taylor@example.invalid', role: 'Another organizer'},
] as const;
export type DemoPerson = typeof demoPeople[number];
