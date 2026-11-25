const day = 86_400_000;
const phoenixOffset = 7 * 60 * 60 * 1000;

export function readershipDay(time) {
  // Phoenix uses UTC-7 throughout the year.
  return new Date(time - phoenixOffset).toISOString().slice(0, 10);
}

export function readershipWeek(time) {
  const start = readershipDay(time - 6 * day);
  const end = readershipDay(time);
  return {
    start, end,
    since: `${start}T07:00:00.000Z`,
    before: `${readershipDay(time + day)}T07:00:00.000Z`,
  };
}
