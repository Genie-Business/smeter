import { badRequest } from './errors.js';

/** Parse `source` with a zod schema, raising a 400 with field errors. */
export function parse(schema, source) {
  const result = schema.safeParse(source ?? {});
  if (!result.success) {
    const fields = {};
    for (const issue of result.error.issues) {
      fields[issue.path.join('.') || '_'] = issue.message;
    }
    throw badRequest(Object.values(fields)[0] ?? 'Invalid input', fields);
  }
  return result.data;
}

export const koboToNaira = (kobo) => Math.round(kobo) / 100;
export const nairaToKobo = (naira) => Math.round(Number(naira) * 100);

export function pageParams(query) {
  const page = Math.max(1, Number.parseInt(query.page ?? '1', 10) || 1);
  const pageSize = Math.min(100, Math.max(1, Number.parseInt(query.pageSize ?? '20', 10) || 20));
  return { page, pageSize, offset: (page - 1) * pageSize };
}
