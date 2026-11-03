// An organization's web address from its name ("East Hamilton High School" → east-hamilton-high-school). No database,
// so the gear's Name form can show it as it's typed.
export const slugFor = (name: string) =>
  name
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 36)
    .replace(/-+$/g, "") || "org";
