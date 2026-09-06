import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();
const hash = (pw: string) => bcrypt.hash(pw, 12);

async function main() {
  const pw = await hash("relay2026");

  const users = [
    {
      name: "Anya Gupta",
      email: "anya@relay.dev",
      role: "MANAGER",
      initials: "AG",
      avatarColor: "#FEF3C7",
    },
    {
      name: "Adveita Bhargava",
      email: "adveita@relay.dev",
      role: "ADMIN",
      initials: "AB",
      avatarColor: "#F3F0FF",
    },
    {
      name: "Akshar Kher",
      email: "akshar@relay.dev",
      role: "DEVELOPER",
      initials: "AK",
      avatarColor: "#E8EAFF",
    },
    {
      name: "Ravi Gupta",
      email: "ravi@relay.dev",
      role: "DEVELOPER",
      initials: "RG",
      avatarColor: "#DCFCE7",
    },
    {
      name: "Jun Rao",
      email: "jun@relay.dev",
      role: "DEVELOPER",
      initials: "JR",
      avatarColor: "#E0F2FE",
    },
    {
      name: "Jason Gustafson",
      email: "jason@relay.dev",
      role: "DEVELOPER",
      initials: "JG",
      avatarColor: "#FDE8FF",
    },
    {
      name: "David Arthur",
      email: "david@relay.dev",
      role: "DEVELOPER",
      initials: "DA",
      avatarColor: "#FEF2F2",
    },
    {
      name: "Priya Sharma",
      email: "priya@relay.dev",
      role: "DEVELOPER",
      initials: "PS",
      avatarColor: "#ECFDF5",
    },
    {
      name: "Omar Hassan",
      email: "omar@relay.dev",
      role: "DEVELOPER",
      initials: "OH",
      avatarColor: "#FFF7ED",
    },
    {
      name: "Seo-Yeon Park",
      email: "seoyeon@relay.dev",
      role: "DEVELOPER",
      initials: "SP",
      avatarColor: "#F0FDF4",
    },
  ];

  for (const u of users) {
    await prisma.user.upsert({
      where: { email: u.email },
      update: {},
      create: { ...u, passwordHash: pw },
    });
  }

  console.log(`Seeded ${users.length} users.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
