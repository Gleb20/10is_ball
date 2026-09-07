import { z } from "zod";

export const ReleaseEnvironmentSchema = z.enum([
  "local",
  "test",
  "staging",
  "production",
]);
export type ReleaseEnvironment = z.infer<typeof ReleaseEnvironmentSchema>;

export const ExactCommitShaSchema = z
  .string()
  .regex(/^[0-9a-f]{40}$/, "sha must be a full 40-character Git SHA");

export const ReleaseMetadataSchema = z
  .object({
    sha: z.string().trim().min(1).max(128),
    version: z
      .string()
      .regex(
        /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/,
        "version must be semantic",
      ),
    environment: ReleaseEnvironmentSchema,
    dirty: z.boolean(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.environment !== "staging" && value.environment !== "production") {
      return;
    }
    if (!ExactCommitShaSchema.safeParse(value.sha).success) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["sha"],
        message: "sha must be a full 40-character Git SHA when deployed",
      });
    }
    if (value.dirty) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["dirty"],
        message: "deployed releases must not be dirty",
      });
    }
  });

export type ReleaseMetadata = z.infer<typeof ReleaseMetadataSchema>;

export function createReleaseMetadata(input: {
  version: string;
  sha?: string;
  environment: ReleaseEnvironment;
  dirty?: boolean;
}): ReleaseMetadata {
  const sha = input.sha?.trim().toLowerCase();
  const deployEnvironment =
    input.environment === "staging" || input.environment === "production";

  if (deployEnvironment && !sha) {
    throw new Error(
      `A full release commit SHA is required in ${input.environment}`,
    );
  }

  return ReleaseMetadataSchema.parse({
    sha: sha || input.environment,
    version: input.version.trim(),
    environment: input.environment,
    dirty: input.dirty ?? false,
  });
}
