const DIRECTIONS = [
  "DoubleDown",
  "SingleDown",
  "FortyFiveDown",
  "Flat",
  "FortyFiveUp",
  "SingleUp",
  "DoubleUp",
];

function compactData(data) {
  return [
    1,
    data.glucose,
    data.delta,
    Math.max(0, DIRECTIONS.indexOf(data.direction)),
    data.readings,
    data.units === "mmol/L" ? 1 : 0,
    data.urgentLow,
    data.low,
    data.high,
    data.alarmEnabled ? 1 : 0,
    data.lowSnooze,
    data.highSnooze,
    data.updated,
    data.fullScreen ? 1 : 0,
  ];
}

module.exports = compactData;
