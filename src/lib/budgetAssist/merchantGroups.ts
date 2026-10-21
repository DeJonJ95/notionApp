import { prisma } from '@/lib/prisma';

// Seeded on first use; the user edits them afterwards from the budget page.
export const DEFAULT_MERCHANT_GROUPS: Record<string, string[]> = {
  fast_food: [
    "McDonald's", "Wendy's", 'Taco Bell', 'Burger King', 'Chick-fil-A', 'Popeyes', 'KFC', 'Subway',
    'Little Caesars', "Domino's", 'Pizza Hut', "Papa John's", "Arby's", 'Sonic Drive', 'White Castle',
    'Jack in the Box', 'Dairy Queen', 'Five Guys', "Jimmy John's", "Jersey Mike's", 'Firehouse Subs',
    'Checkers', "Rally's", "Hardee's", "Carl's Jr", "Culver's", "Raising Cane's", 'Wingstop',
    'Panda Express', 'Del Taco', "Zaxby's", 'Whataburger',
  ],
  delivery: ['DoorDash', 'Uber Eats', 'Grubhub', 'Postmates', 'Seamless', 'Caviar'],
};

export const GROUP_NAME = /^[a-z][a-z0-9_]{1,30}$/;

/** How the SQL matches a pattern: lowercase with everything but letters and digits removed. */
export const normalizePattern = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

export type MerchantGroups = Record<string, { id: string; pattern: string }[]>;

// The panel and the assistant both read the groups on first open, so two requests
// can arrive together; the per-user lock keeps them from seeding twice.
async function seedDefaults(userId: string) {
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT 1 FROM (SELECT pg_advisory_xact_lock(hashtext(${userId}))) AS locked`;
    if ((await tx.merchantPattern.count({ where: { userId } })) > 0) return;
    await tx.merchantPattern.createMany({
      data: Object.entries(DEFAULT_MERCHANT_GROUPS).flatMap(([groupName, patterns]) =>
        patterns.map((pattern) => ({ userId, groupName, pattern }))),
    });
  });
}

export async function merchantGroups(userId: string): Promise<MerchantGroups> {
  if ((await prisma.merchantPattern.count({ where: { userId } })) === 0) await seedDefaults(userId);
  const rows = await prisma.merchantPattern.findMany({ where: { userId }, orderBy: [{ groupName: 'asc' }, { pattern: 'asc' }] });
  const groups: MerchantGroups = {};
  for (const r of rows) (groups[r.groupName] ??= []).push({ id: r.id, pattern: r.pattern });
  return groups;
}
