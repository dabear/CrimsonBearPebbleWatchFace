const DIRECTIONS = [
  "DoubleDown",
  "SingleDown",
  "FortyFiveDown",
  "Flat",
  "FortyFiveUp",
  "SingleUp",
  "DoubleUp",
];

export function expandData(values) {
  if (!Array.isArray(values)) return values;
  return {
    glucose: values[1],
    delta: values[2],
    direction: DIRECTIONS[values[3]] || "Flat",
    readings: values[4] || [],
    units: values[5] ? "mmol/L" : "mg/dL",
    urgentLow: values[6],
    low: values[7],
    high: values[8],
    alarmEnabled: Boolean(values[9]),
    lowSnooze: values[10],
    highSnooze: values[11],
    updated: values[12],
    fullScreen: Boolean(values[13]),
  };
}
