/* Where Angela's two tools live, so each can link to the other.
 *
 * In the routed site they are hash routes in the same page. In the one-file
 * builds published as Claude artifacts there is no router - each artifact is
 * its own page at its own claude.ai URL - so the link has to be that URL. An
 * artifact's URL stays the same across republishes, so these only change if
 * one is deleted and published afresh. Links out of an artifact open in a new
 * tab, which is the viewer's doing, not something to fight.
 */
export const LISTING_ARTIFACT = "https://claude.ai/artifact/FyuGyUpdSnK7F7tak7fGe8";
export const TITLE_ARTIFACT = "https://claude.ai/artifact/SM7skdzuzCunhTf4DxpJ26";
