import { getDb } from "@/lib/db";
import { readRatingTags, type RatingTags } from "@/lib/ratingTags";

/** The company's rating tags (lib/ratingTags.ts), the defaults until the owner edits them. */
export async function ratingTagsFor(organizationId: number): Promise<RatingTags> {
  const row = (await getDb().prepare("SELECT rating_tags_json FROM organizations WHERE id = ?").get(organizationId)) as
    | { rating_tags_json: string | null }
    | undefined;
  return readRatingTags(row?.rating_tags_json);
}

export async function setRatingTags(organizationId: number, tags: RatingTags): Promise<void> {
  await getDb().prepare("UPDATE organizations SET rating_tags_json = ? WHERE id = ?").run(JSON.stringify(tags), organizationId);
}
