/** Single source of truth for identity, links and base-aware URLs. */

export const SITE = {
  name: 'Kristian de France',
  title: 'Kristian de France — Software Engineer, Auckland NZ',
  description:
    'Systems-oriented software engineer in Auckland, New Zealand. C++ and C#: engine systems, AI navigation, cloth simulation, and a shipped Steam title.',
  email: 'krisdfrance@gmail.com',
  location: 'Auckland, New Zealand',
  github: 'https://github.com/kristiandFrance',
  linkedin: 'https://www.linkedin.com/in/kristian-defrance/',
  steam: 'https://store.steampowered.com/app/3386150/Youre_here_again/',
  itch: 'https://finn25.itch.io/tangletails',
  clothRepo: 'https://github.com/kristiandFrance/ClothSimulation',
} as const;

/** Prefix a root-relative path with the deploy base (project vs user pages). */
export function withBase(path: string): string {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  return `${base}${path}`;
}
