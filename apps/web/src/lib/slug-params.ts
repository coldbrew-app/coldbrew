import { SlugSchema, type Slug } from "@coldbrew/packages/schemas.js";
import { z } from "zod";

const SlugParamsSchema = z.object({
  slug: z
    .string()
    .startsWith("@")
    .transform((value) => value.slice(1))
    .pipe(SlugSchema),
});

export const slugParams = {
  parse: (params: { slug: string }) => SlugParamsSchema.parse(params),
  stringify: ({ slug }: { slug: Slug }) => ({ slug: `@${slug}` }),
};
