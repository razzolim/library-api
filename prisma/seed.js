import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} environment variable is not set`);
  }
  return value;
}

const demoUser = {
  username: requireEnv('DEMO_USER_USERNAME'),
  password: requireEnv('DEMO_USER_PASSWORD'),
  fullName: requireEnv('DEMO_USER_FULL_NAME'),
  role: requireEnv('DEMO_USER_ROLE'),
};

const adminUser = process.env.ADMIN_USER_USERNAME
  ? {
      username: process.env.ADMIN_USER_USERNAME,
      password: requireEnv('ADMIN_USER_PASSWORD'),
      fullName: requireEnv('ADMIN_USER_FULL_NAME'),
    }
  : null;

const demoChangelog = [
  {
    version: '1.3.0',
    date: '2026-08-15',
    title: 'Profile menu and account page',
    description:
      "## What's new\n\n- The header now shows a **profile icon** that opens a dropdown menu.\n- A new **Account** page lets you view your profile details.\n- Language settings have moved from the header to the Account page.",
  },
  {
    version: '1.2.0',
    date: '2026-08-10',
    title: 'Change log page',
    description:
      "## What's new\n\n- A **Change log** link is now available in the footer.\n- Change log entries support Markdown descriptions, so updates can include formatted lists, links, and headings.",
  },
  {
    version: '1.1.0',
    date: '2026-08-05',
    title: 'Book collection and PDF reader',
    description:
      "## What's new\n\n- Browse the library collection with search and pagination.\n- View book details in a modal.\n- Open a dedicated PDF reader tab for books with an online copy.",
  },
  {
    version: '1.0.0',
    date: '2026-08-01',
    title: 'Initial release',
    description:
      "## What's new\n\n- Login page with authentication.\n- Support for English and Brazilian Portuguese.\n- Responsive layout built with Vue 3, Vite, Pinia, and Vue Router.",
  },
];

async function main() {
  const passwordHash = await bcrypt.hash(demoUser.password, 10);

  await prisma.user.upsert({
    where: { username: demoUser.username },
    update: {
      password: passwordHash,
      fullName: demoUser.fullName,
      role: demoUser.role,
    },
    create: {
      username: demoUser.username,
      password: passwordHash,
      fullName: demoUser.fullName,
      role: demoUser.role,
    },
  });

  if (adminUser) {
    const adminPasswordHash = await bcrypt.hash(adminUser.password, 10);
    await prisma.user.upsert({
      where: { username: adminUser.username },
      update: {
        password: adminPasswordHash,
        fullName: adminUser.fullName,
        role: 'admin',
      },
      create: {
        username: adminUser.username,
        password: adminPasswordHash,
        fullName: adminUser.fullName,
        role: 'admin',
      },
    });
  }

  for (const entry of demoChangelog) {
    await prisma.changelogEntry.upsert({
      where: { version: entry.version },
      update: entry,
      create: entry,
    });
  }

  const userCount = adminUser ? 2 : 1;
  console.log(`Seeded ${userCount} user(s) and ${demoChangelog.length} changelog entries.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
