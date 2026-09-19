import { formatLocalDate } from "@/lib/analysis";

export interface DemoEvent {
  id: string;
  title: string;
  date: string;
  time: string;
  duration: string;
  importance: string;
  moveable: boolean;
  recurring: boolean;
  calendar: string;
}

// Independently invented legacy-widget examples. The full demo uses demo/calendars.ts.
const TEMPLATES = [
  {title: "Community seed sorting", recurring: true, importance: "low", moveable: true, time: "10:00 AM", duration: "45min", calendar: "Community"},
  {title: "Observatory orientation", recurring: false, importance: "high", moveable: false, time: "8:00 PM", duration: "2hr", calendar: "Learning"},
  {title: "Printmaking studio", recurring: true, importance: "medium", moveable: true, time: "11:00 AM", duration: "1hr", calendar: "Personal"},
  {title: "Robotics exhibition shift", recurring: false, importance: "critical", moveable: false, time: "1:00 PM", duration: "3hr", calendar: "Community"},
  {title: "Library design review", recurring: true, importance: "medium", moveable: true, time: "2:00 PM", duration: "1hr", calendar: "Work"},
];

export function generateDemoEvents(
  startDate: string,
  endDate: string,
  random: () => number = Math.random
): DemoEvent[] {
  const events: DemoEvent[] = [];
  const current = new Date(startDate + "T12:00:00");
  const end = new Date(endDate + "T12:00:00");

  while (current <= end) {
    const dayOfWeek = current.getDay();
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
    const maxEvents = isWeekend ? 2 : 3;
    const count = Math.floor(random() * maxEvents) + (dayOfWeek === 0 ? 0 : 1);
    const pool = isWeekend
      ? TEMPLATES.filter((template) => template.calendar !== "Work")
      : TEMPLATES;
    const shuffled = [...pool].sort(() => random() - 0.5);

    for (let index = 0; index < Math.min(count, shuffled.length); index += 1) {
      const template = shuffled[index];
      const date = formatLocalDate(current);
      events.push({
        id: `evt-${date}-${index}`,
        title: template.title,
        date,
        time: template.time,
        duration: template.duration,
        importance: template.importance,
        moveable: template.moveable,
        recurring: template.recurring,
        calendar: template.calendar,
      });
    }

    current.setDate(current.getDate() + 1);
  }

  return events;
}
