/** Options de catégories dans l'ordre de l'arborescence, indentées par niveau. */
export function categoryOptions(
  rows: readonly { id: string; parentId: string | null; name: string; isActive: boolean }[],
  options: { exclude?: string } = {},
): { value: string; label: string }[] {
  const children = new Map<string | null, typeof rows[number][]>();
  for (const row of rows) children.set(row.parentId, [...(children.get(row.parentId) ?? []), row]);
  const result: { value: string; label: string }[] = [];
  const visit = (parentId: string | null, depth: number) => {
    for (const row of children.get(parentId) ?? []) {
      // Une catégorie exclue (édition) emporte ses descendants : on ne peut pas s'y ranger.
      if (row.id === options.exclude || depth > 20) continue;
      result.push({ value: row.id, label: `${"— ".repeat(depth)}${row.name}${row.isActive ? "" : " (inactive)"}` });
      visit(row.id, depth + 1);
    }
  };
  visit(null, 0);
  return result;
}
