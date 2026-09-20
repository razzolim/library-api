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

const demoBooks = [
  {
    title: 'The Pragmatic Programmer',
    author: 'Andrew Hunt & David Thomas',
    year: 1999,
    genre: 'Software Engineering',
    status: 'available',
    isbn: '978-0201616224',
    coverColor: '#4a5568',
    summary: 'A catalog of practical, tool-agnostic habits for writing adaptable, DRY software, from source control discipline to pragmatic testing.',
    pdfUrl: 'https://drive.google.com/file/d/1cElC7xqVArPo9jZMWDksRHtIwCxSq-qi/view',
  },
  {
    title: 'Clean Code',
    author: 'Robert C. Martin',
    year: 2008,
    genre: 'Software Engineering',
    status: 'borrowed',
    isbn: '978-0132350884',
    coverColor: '#2b6cb0',
    summary: 'A field guide to writing readable, maintainable code, covering naming, functions, and refactoring through worked examples.',
  },
  {
    title: 'Design Patterns',
    author: 'Erich Gamma, Richard Helm, Ralph Johnson & John Vlissides',
    year: 1994,
    genre: 'Software Architecture',
    status: 'available',
    isbn: '978-0201633610',
    coverColor: '#805ad5',
    summary: 'The classic "Gang of Four" catalog of 23 reusable object-oriented design patterns for common software design problems.',
    pdfUrl: 'https://drive.google.com/file/d/1cElC7xqVArPo9jZMWDksRHtIwCxSq-qi/view',
  },
  {
    title: 'Clean Architecture',
    author: 'Robert C. Martin',
    year: 2017,
    genre: 'Software Architecture',
    status: 'available',
    isbn: '978-0134494166',
    coverColor: '#d69e2e',
    summary: 'Lays out principles for structuring systems so business rules stay independent of frameworks, databases, and UI.',
  },
  {
    title: 'Domain-Driven Design',
    author: 'Eric Evans',
    year: 2003,
    genre: 'Software Architecture',
    status: 'borrowed',
    isbn: '978-0321125217',
    coverColor: '#38a169',
    summary: 'Introduces a shared modeling language and strategic design patterns for tackling complexity in the heart of software.',
    pdfUrl: 'https://drive.google.com/file/d/1cElC7xqVArPo9jZMWDksRHtIwCxSq-qi/view',
  },
  {
    title: 'The C Programming Language',
    author: 'Brian Kernighan & Dennis Ritchie',
    year: 1978,
    genre: 'Programming',
    status: 'available',
    isbn: '978-0131103627',
    coverColor: '#e53e3e',
    summary: 'The definitive, concise reference to C, written by its creators, covering the language and its standard library.',
  },
  {
    title: 'Effective Java',
    author: 'Joshua Bloch',
    year: 2017,
    genre: 'Programming',
    status: 'available',
    isbn: '978-0134685991',
    coverColor: '#dd6b20',
    summary: '90 concrete items of advice for writing clear, correct, and efficient Java, grounded in real API design experience.',
    pdfUrl: 'https://drive.google.com/file/d/1cElC7xqVArPo9jZMWDksRHtIwCxSq-qi/view',
  },
  {
    title: 'Eloquent JavaScript',
    author: 'Marijn Haverbeke',
    year: 2018,
    genre: 'Programming',
    status: 'borrowed',
    isbn: '978-1593279509',
    coverColor: '#319795',
    summary: 'A modern introduction to JavaScript, the browser, and Node.js, blending language fundamentals with hands-on projects.',
  },
  {
    title: 'The Mythical Man-Month',
    author: 'Frederick P. Brooks Jr.',
    year: 1975,
    genre: 'Project Management',
    status: 'available',
    isbn: '978-0201835953',
    coverColor: '#718096',
    summary: 'Essays on software project management drawn from the OS/360 project, including the famous observation that adding manpower to a late project makes it later.',
    pdfUrl: 'https://drive.google.com/file/d/1cElC7xqVArPo9jZMWDksRHtIwCxSq-qi/view',
  },
  {
    title: 'Introduction to Algorithms',
    author: 'Thomas H. Cormen, Charles E. Leiserson, Ronald L. Rivest & Clifford Stein',
    year: 2009,
    genre: 'Computer Science',
    status: 'available',
    isbn: '978-0262033848',
    coverColor: '#3182ce',
    summary: 'A comprehensive, rigorous treatment of algorithms and data structures, widely used as the standard university textbook.',
  },
  {
    title: 'Structure and Interpretation of Computer Programs',
    author: 'Harold Abelson & Gerald Jay Sussman',
    year: 1996,
    genre: 'Computer Science',
    status: 'borrowed',
    isbn: '978-0262510875',
    coverColor: '#6b46c1',
    summary: 'A foundational text on programming as the construction of abstractions, taught through Scheme, from MIT’s classic introductory course.',
    pdfUrl: 'https://drive.google.com/file/d/1cElC7xqVArPo9jZMWDksRHtIwCxSq-qi/view',
  },
  {
    title: 'The Phoenix Project',
    author: 'Gene Kim, Kevin Behr & George Spafford',
    year: 2013,
    genre: 'DevOps',
    status: 'available',
    isbn: '978-1942788294',
    coverColor: '#d53f8c',
    summary: 'A novel about an IT manager rescuing a failing project, used to illustrate DevOps and The Three Ways in narrative form.',
  },
];

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

  for (const book of demoBooks) {
    await prisma.book.upsert({
      where: { isbn: book.isbn },
      update: book,
      create: book,
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
  console.log(`Seeded ${userCount} user(s), ${demoBooks.length} books, and ${demoChangelog.length} changelog entries.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
