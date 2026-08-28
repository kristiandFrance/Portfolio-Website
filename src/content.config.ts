import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

/**
 * One source for project content: the cards on the front page and the
 * /work/* case-study pages both render from these entries.
 */
const work = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/work' }),
  schema: z.object({
    title: z.string(),
    /** mono meta line, e.g. "UNITY PLUGIN · C# · SOLO" */
    meta: z.string(),
    /** card body — two sentences max */
    blurb: z.string(),
    /** sub-detail revealed when the card subdivides */
    detail: z.array(z.string()),
    order: z.number(),
    /** render as a card in the Projects section */
    card: z.boolean().default(false),
    /** render a /work/<id> case-study page from the markdown body */
    caseStudy: z.boolean().default(false),
    /** external link shown on the card (label + href) */
    link: z
      .object({ label: z.string(), href: z.string().url() })
      .optional(),
    /** figures rendered after the case-study prose; src is base-relative
        into public/, e.g. "/media/foo.webp" */
    media: z
      .array(
        z.object({
          src: z.string(),
          alt: z.string(),
          caption: z.string(),
          width: z.number(),
          height: z.number(),
          span2: z.boolean().default(false),
        })
      )
      .optional(),
  }),
});

export const collections = { work };
