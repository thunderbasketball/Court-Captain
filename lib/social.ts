// The League's Instagram handle, tagged in the caption of every game and final shared from the app (Instagram doesn't let an
// app tag an account itself: the caption is copied to paste into the post).
export const LEAGUE_INSTAGRAM = "ScenicCityBBall";
export const withTag = (text: string, tag: string | undefined) => (tag ? `${text} @${tag}` : text);
