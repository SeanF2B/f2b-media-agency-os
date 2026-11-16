export type Person = { firstName: string; lastName: string };
export function slug(value: string): string;
export function parsePeople(text: string): Person[];
export function fillIdentities(people: Person[], count: number): Array<Person & { local: string }>;
