// A registered organization's Facilities sub-tabs: Availability and Gyms.
export const orgFacilityLinks = (slug: string) => [
  { key: "availability", href: `/org/${slug}/facilities`, label: "Availability" },
  { key: "gyms", href: `/org/${slug}/facilities/gyms`, label: "Gyms" },
];
