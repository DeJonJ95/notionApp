export type DbPropertyDef = {
  name: string;
  type: 'text' | 'number' | 'date' | 'select' | 'checkbox' | 'formula';
  options?: string[]; // select options — stored as JSON in property.formula
  formula?: string;  // formula expression for formula type
};

export type DbViewDef = {
  name: string;
  type: 'table' | 'board' | 'calendar' | 'gallery' | 'list' | 'budget-summary' | 'spending-breakdown';
};

export type DbTemplate = {
  id: string;
  name: string;
  description: string;
  icon: string;
  properties: DbPropertyDef[];
  views: DbViewDef[];
};

export const DB_TEMPLATES: DbTemplate[] = [
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
          'Emergency Fund', 'Other',
        ],
      },
      { name: 'Amount', type: 'number' },
      { name: 'Budgeted Amount', type: 'number' },
      { name: 'Date', type: 'date' },
      { name: 'Due Date', type: 'date' },
      { name: 'Vendor', type: 'text' },
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
];
