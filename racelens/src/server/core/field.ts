/**
 * Who actually starts. An emergency only runs if a horse is scratched before the emergency deadline, taking the
 * vacancy in emergency order (lowest saddlecloth first). Once the deadline passes the official sources scratch the
 * emergencies that missed out, so this rule only matters for research done the night before or early on race day.
 */
export function starters<T extends { number: number; scratched?: boolean; emergency?: boolean }>(runners: T[]): T[] {
  const vacancies = runners.filter((r) => r.scratched && !r.emergency).length;
  const emergencies = runners
    .filter((r) => !r.scratched && r.emergency)
    .sort((a, b) => a.number - b.number)
    .slice(0, vacancies);
  return runners.filter((r) => !r.scratched && (!r.emergency || emergencies.includes(r)));
}

/** An emergency that, as things stand, does not get a start. */
export function isWaitingEmergency<T extends { number: number; scratched?: boolean; emergency?: boolean }>(runner: T, runners: T[]): boolean {
  return !!runner.emergency && !runner.scratched && !starters(runners).includes(runner);
}
