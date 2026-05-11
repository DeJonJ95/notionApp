import { NextAuthOptions, getServerSession } from 'next-auth';
import { PrismaAdapter } from '@auth/prisma-adapter';
import EmailProvider from 'next-auth/providers/email';
import GoogleProvider from 'next-auth/providers/google';
import { prisma } from './prisma';

export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(prisma) as any,
  providers: [
    EmailProvider({
      server: {
        host: process.env.EMAIL_SERVER_HOST,
        port: Number(process.env.EMAIL_SERVER_PORT),
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
          }),
        ]
      : []),
  ],
  session: { strategy: 'database' },
  pages: { signIn: '/signin' },
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
