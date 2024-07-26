import { NextAuthOptions, getServerSession } from 'next-auth';
import { PrismaAdapter } from '@auth/prisma-adapter';
import EmailProvider from 'next-auth/providers/email';
import GoogleProvider from 'next-auth/providers/google';
import { prisma } from './prisma';

const emailServerPort = process.env.EMAIL_SERVER_PORT ? Number(process.env.EMAIL_SERVER_PORT) : undefined;

if (process.env.NODE_ENV === 'production') {
  const required = [
    'NEXTAUTH_URL',
    'NEXTAUTH_SECRET',
    'EMAIL_SERVER_HOST',
    'EMAIL_SERVER_PORT',
    'EMAIL_SERVER_USER',
    'EMAIL_SERVER_PASSWORD',
    'EMAIL_FROM',
  ];

  const missing = required.filter((name) => !process.env[name]);
  if (missing.length) {
    throw new Error(
      `Missing required environment variables for authentication: ${missing.join(', ')}`
    );
  }

  if (Number.isNaN(emailServerPort)) {
    throw new Error('EMAIL_SERVER_PORT must be set to a valid port number');
  }

  // Additional validation for email domain
  const emailFrom = process.env.EMAIL_FROM;
  if (emailFrom && !emailFrom.includes('@')) {
    throw new Error('EMAIL_FROM must be a valid email address');
  }
}

export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(prisma) as any,
  secret: process.env.NEXTAUTH_SECRET,
  providers: [
    EmailProvider({
      server: {
        host: process.env.EMAIL_SERVER_HOST,
        port: emailServerPort,
        secure: emailServerPort === 465, // true for 465 (SSL), false for 587 (TLS)
        auth: {
          user: process.env.EMAIL_SERVER_USER,
          pass: process.env.EMAIL_SERVER_PASSWORD,
        },
      },
      from: process.env.EMAIL_FROM,
    }),
    ...(process.env.GOOGLE_CLIENT_ID
      ? [
          GoogleProvider({
            clientId: process.env.GOOGLE_CLIENT_ID!,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
            allowDangerousEmailAccountLinking: true,
          }),
        ]
      : []),
  ],
  session: { strategy: 'database' },
  pages: {
    signIn: '/signin',
    error: '/signin',
    verifyRequest: '/signin',
  },
  callbacks: {
    async session({ session, user }) {
      if (session.user) (session.user as any).id = user.id;
      return session;
    },
  },
  events: {
    // Auto-create default workspaces on first sign-in
    async createUser({ user }) {
      const defaults = [
        { name: 'Work', slug: 'work', icon: '💼', color: '#3B82F6' },
        { name: 'Side Gig', slug: 'side-gig', icon: '🚀', color: '#F59E0B' },
        { name: 'Personal', slug: 'personal', icon: '🏠', color: '#10B981' },
      ];
      for (const w of defaults) {
        await prisma.workspace.create({
          data: { ...w, ownerId: user.id! },
        });
      }
    },
  },
};

export const auth = () => getServerSession(authOptions);
