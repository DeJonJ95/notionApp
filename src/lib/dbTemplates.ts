export type DbPropertyDef = {
  name: string;
  type: 'text' | 'number' | 'date' | 'select' | 'checkbox';
  options?: string[]; // select options — stored as JSON in property.formula
};

export type DbViewDef = {
  name: string;
  type: 'table' | 'board' | 'calendar' | 'gallery' | 'list';
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

  {
    id: 'personal-budget',
    name: 'Personal Budget',
    description: 'Log income and expenses by category to stay on top of your finances.',
    icon: '💰',
    properties: [
      { name: 'Type', type: 'select', options: ['Income', 'Expense'] },
      { name: 'Category', type: 'select', options: ['Housing', 'Food', 'Transport', 'Utilities', 'Health', 'Entertainment', 'Savings', 'Other'] },
      { name: 'Amount', type: 'number' },
      { name: 'Date', type: 'date' },
      { name: 'Notes', type: 'text' },
    ],
    views: [
      { name: 'All Transactions', type: 'table' },
      { name: 'Calendar', type: 'calendar' },
      { name: 'By Type', type: 'board' },
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
