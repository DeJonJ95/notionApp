// Calendar facts for the assistant's prompt, computed here so the model copies
// date ranges instead of working them out. Months are calendar months in Detroit.

const TZ = 'America/Detroit';

export function detroitToday(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

const ymParts = (ym: string) => ym.split('-').map(Number) as [number, number];

export function shiftMonth(ym: string, months: number): string {
  const [y, m] = ymParts(ym);
  return new Date(Date.UTC(y, m - 1 + months, 1)).toISOString().slice(0, 7);
}

export function monthEnd(ym: string): string {
  const [y, m] = ymParts(ym);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

const label = (ym: string) => {
  const [y, m] = ymParts(ym);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
};

/** The lines the system prompt carries about today and the default periods. */
export function calendarLines(today: string): string[] {
  const thisMonth = today.slice(0, 7);
  const last = shiftMonth(thisMonth, -1);
  const first3 = shiftMonth(thisMonth, -3);
  const weekday = new Date(today + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' });
  return [
    `Today in Detroit: ${today} (${weekday}).`,
    `Current month: ${label(thisMonth)}, ${thisMonth}-01 to ${monthEnd(thisMonth)}. It is partial: day ${Number(today.slice(8))} of ${Number(monthEnd(thisMonth).slice(8))}.`,
    `Last closed month: ${label(last)}, ${last}-01 to ${monthEnd(last)}.`,
    `Last 3 closed months: ${label(first3)} to ${label(last)}, ${first3}-01 to ${monthEnd(last)}.`,
  ];
}
