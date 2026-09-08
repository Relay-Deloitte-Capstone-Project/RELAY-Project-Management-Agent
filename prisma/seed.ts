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
      role: "ADMIN",
      initials: "AG",
      avatarColor: "#FEF3C7",
    },
    {
      name: "Adveita Bhargava",
      email: "adveita@relay.dev",
      role: "MANAGER",
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
      name: "Agrim_Gairola",
      email: "agrim@relay.dev",
      role: "DEVELOPER",
      initials: "AG",
      avatarColor: "#DCFCE7",
    },
    {
      name: "Shubhr Aryan",
      email: "shubhr@relay.dev",
      role: "DEVELOPER",
      initials: "SA",
      avatarColor: "#E0F2FE",
    },
    {
      name: "Priya Kumar",
      email: "priya@relay.dev",
      role: "DEVELOPER",
      initials: "PK",
      avatarColor: "#ECFDF5",
    },
    {
      name: "Jason Maro",
      email: "jason@relay.dev",
      role: "DEVELOPER",
      initials: "JM",
      avatarColor: "#FDE8FF",
    },
    {
      name: "Omar K",
      email: "omar@relay.dev",
      role: "DEVELOPER",
      initials: "OK",
      avatarColor: "#FFF7ED",
    },
  ];

  // Local demo data, not anything worth preserving across reseeds — wipe and
  // recreate so a roster change (renames, role swaps, dropped people) always
  // actually takes effect, rather than being silently ignored by an upsert.
  await prisma.user.deleteMany({});
  for (const u of users) {
    await prisma.user.create({ data: { ...u, passwordHash: pw } });
  }

  console.log(`Seeded ${users.length} users.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
