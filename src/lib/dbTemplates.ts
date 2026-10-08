export type DbPropertyDef = {
  name: string;
  type: 'text' | 'number' | 'date' | 'select' | 'checkbox' | 'formula' | 'relation';
  options?: string[]; // select options — stored as JSON in property.formula
  relationTo?: 'self' | 'companion';
  formula?: string;  // formula expression for formula type
};

export type DbViewDef = {
  name: string;
  type: 'table' | 'board' | 'calendar' | 'gallery' | 'list' | 'budget-summary' | 'spending-breakdown' | 'map';
  filters?: { property: string; op: 'contains' | 'eq' | 'gte' | 'lte'; value: string }[];
};

export type DbTemplate = {
  id: string;
  name: string;
  description: string;
  icon: string;
  properties: DbPropertyDef[];
  views: DbViewDef[];
  companion?: { name: string; properties: DbPropertyDef[]; views: DbViewDef[] };
};

export const DB_TEMPLATES: DbTemplate[] = [
  {
    id: 'projects-map',
    name: 'Projects',
    description: 'Whole projects on a map, wired by what each one waits on.',
    icon: '🗺️',
    properties: [
      { name: 'Status', type: 'select', options: ['Planned', 'In progress', 'In review', 'Done'] },
      { name: 'Area', type: 'select', options: ['Work', 'Personal', 'Learning'] },
      { name: 'Waits on', type: 'relation', relationTo: 'self' },
      { name: 'Tasks', type: 'relation', relationTo: 'companion' },
      { name: 'Next action', type: 'text' },
      { name: 'Due Date', type: 'date' },
    ],
    views: [
      { name: 'Map', type: 'map' },
      { name: 'All projects', type: 'table' },
    ],
    companion: {
      name: 'Tasks',
      properties: [
        { name: 'Status', type: 'select', options: ['To do', 'Doing', 'Done'] },
        { name: 'Due Date', type: 'date' },
      ],
      views: [
        { name: 'Board', type: 'board' },
        { name: 'All tasks', type: 'table' },
      ],
    },
  },

  {
    id: 'project-tracker',
    name: 'Project Tracker',
    description: 'Track tasks and projects with status, priority, and due dates.',
    icon: '🚀',
    properties: [
      { name: 'Status', type: 'select', options: ['Not Started', 'In Progress', 'In Review', 'Complete', 'Blocked'] },
      { name: 'Priority', type: 'select', options: ['Low', 'Medium', 'High', 'Critical'] },
      { name: 'Due Date', type: 'date' },
      { name: 'Assignee', type: 'text' },
      { name: 'Category', type: 'select', options: ['Feature', 'Bug', 'Research', 'Design', 'Ops'] },
    ],
    views: [
      { name: 'All Tasks', type: 'table' },
      { name: 'Board', type: 'board' },
    ],
  },

  // ── Personal Budget (transaction ledger) ───────────────────────────────────
  // Lean by design: add a row with Type=Budget to set a category envelope,
  // then log Income/Expense rows against it. Budget Summary view sums them.
  {
    id: 'personal-budget',
    name: 'Personal Budget',
    description: 'Track income, expenses, and category budgets. Add a row with Type = Budget to set an envelope, then log transactions against it.',
    icon: '💰',
    properties: [
      {
        name: 'Type',
        type: 'select',
        options: ['Income', 'Expense', 'Budget', 'Savings'],
      },
      {
        name: 'Category',
        type: 'select',
        options: [
          'Housing', 'Food & Dining', 'Transport', 'Utilities', 'Healthcare',
          'Insurance', 'Entertainment', 'Shopping', 'Education', 'Personal Care',
          'Subscriptions', 'Investments', 'Debt', 'Gifts & Donations',
          'Emergency Fund', 'Transfers', 'Other',
        ],
      },
      { name: 'Amount', type: 'number' },
      { name: 'Budgeted Amount', type: 'number' },
      { name: 'Date', type: 'date' },
      { name: 'Due Date', type: 'date' },
      { name: 'Vendor', type: 'text' },
      { name: 'Account', type: 'text' },
      {
        name: 'Payment Method',
        type: 'select',
        options: ['Checking', 'Credit Card', 'Cash', 'Other'],
      },
      {
        name: 'Status',
        type: 'select',
        options: ['Planned', 'Cleared'],
      },
      { name: 'Notes', type: 'text' },
    ],
    views: [
      { name: 'All Transactions', type: 'table' },
      { name: 'Budget Summary', type: 'budget-summary' },
      { name: 'Spending Breakdown', type: 'spending-breakdown' },
      { name: 'Calendar', type: 'calendar' },
      { name: 'By Status', type: 'board' },
    ],
  },

  // ── Budget Planner (YNAB-style envelope budgeting) ───────────────────────────
  {
    id: 'budget-planner',
    name: 'Budget Planner',
    description: 'YNAB-style envelope budgeting. Set weekly, bi-weekly, and monthly targets per category. Track spent vs budgeted to see what\'s available.',
    icon: '📊',
    properties: [
      {
        name: 'Category',
        type: 'select',
        options: [
          'Housing', 'Food & Dining', 'Transport', 'Utilities', 'Healthcare',
          'Insurance', 'Entertainment', 'Shopping', 'Education', 'Personal Care',
          'Subscriptions', 'Investments', 'Debt', 'Business', 'Gifts & Donations',
          'Emergency Fund', 'Other',
        ],
      },
      { name: 'Weekly Budget', type: 'number' },
      { name: 'Bi-Weekly Budget', type: 'number' },
      { name: 'Monthly Budget', type: 'number' },
      { name: 'Spent', type: 'number' },
      { name: 'Remaining', type: 'number' },
      {
        name: 'Status',
        type: 'select',
        options: ['On Track', 'Warning', 'Over Budget', 'Funded', 'Underfunded'],
      },
      { name: 'Goal', type: 'number' },
      { name: 'Notes', type: 'text' },
    ],
    views: [
      { name: 'All Envelopes', type: 'table' },
      { name: 'By Status', type: 'board' },
      { name: 'Gallery', type: 'gallery' },
    ],
  },

  {
    id: 'reading-list',
    name: 'Reading List',
    description: 'Manage your books with status, rating, and genre tracking.',
    icon: '📚',
    properties: [
      { name: 'Author', type: 'text' },
      { name: 'Status', type: 'select', options: ['Want to Read', 'Reading', 'Finished', 'Abandoned'] },
      { name: 'Genre', type: 'select', options: ['Fiction', 'Non-Fiction', 'Sci-Fi', 'Biography', 'Self-Help', 'History', 'Technical', 'Other'] },
      { name: 'Rating', type: 'number' },
      { name: 'Date Finished', type: 'date' },
      { name: 'Recommended By', type: 'text' },
    ],
    views: [
      { name: 'All Books', type: 'table' },
      { name: 'By Status', type: 'board' },
      { name: 'Gallery', type: 'gallery' },
    ],
  },

  {
    id: 'habit-tracker',
    name: 'Habit Tracker',
    description: 'Build consistency by logging habits with streaks and completion status.',
    icon: '✅',
    properties: [
      { name: 'Frequency', type: 'select', options: ['Daily', 'Weekly', 'Monthly'] },
      { name: 'Done', type: 'checkbox' },
      { name: 'Streak', type: 'number' },
      { name: 'Last Completed', type: 'date' },
      { name: 'Category', type: 'select', options: ['Health', 'Learning', 'Fitness', 'Mindfulness', 'Work', 'Social'] },
    ],
    views: [
      { name: 'All Habits', type: 'table' },
      { name: 'By Frequency', type: 'board' },
    ],
  },

  {
    id: 'crm',
    name: 'CRM / Contacts',
    description: 'Keep track of professional contacts, follow-ups, and relationship status.',
    icon: '🤝',
    properties: [
      { name: 'Company', type: 'text' },
      { name: 'Role', type: 'text' },
      { name: 'Email', type: 'text' },
      { name: 'Phone', type: 'text' },
      { name: 'Status', type: 'select', options: ['Lead', 'Active', 'Follow Up', 'Inactive'] },
      { name: 'Priority', type: 'select', options: ['Hot', 'Warm', 'Cold'] },
      { name: 'Last Contacted', type: 'date' },
    ],
    views: [
      { name: 'All Contacts', type: 'table' },
      { name: 'Pipeline', type: 'board' },
    ],
  },
  {
    id: 'guest-list',
    name: 'Guest List',
    description: 'Track RSVPs, who actually came, and who you have invited next. Import a Partiful guest CSV or paste a list of names.',
    icon: '🎟️',
    properties: [
      { name: 'Status', type: 'select', options: ['Going', 'Maybe', "Can't Go", 'Invited'] },
      { name: 'Source', type: 'select', options: ['Partiful', 'Text', 'DM', 'Walk-in'] },
      { name: 'Attended', type: 'select', options: ['Yes', 'No'] },
      { name: 'Sunday Invite', type: 'select', options: ['Not invited', 'Invited', 'Confirmed'] },
      { name: 'Phone / IG', type: 'text' },
      { name: 'RSVP date', type: 'date' },
      { name: 'Invited By', type: 'text' },
      { name: 'Is Plus One Of', type: 'text' },
    ],
    views: [
      { name: 'All Guests', type: 'table' },
      { name: 'Came, not yet invited', type: 'table', filters: [
        { property: 'Attended', op: 'eq', value: 'Yes' },
        { property: 'Sunday Invite', op: 'eq', value: 'Not invited' },
      ] },
      { name: 'Invited', type: 'table', filters: [{ property: 'Sunday Invite', op: 'eq', value: 'Invited' }] },
      { name: 'Board', type: 'board' },
    ],
  },
];
