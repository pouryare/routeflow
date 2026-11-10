/** framer-motion's animation features, loaded after the page by the header's LazyMotion
 *  (HoverPill, SearchOverlay), so the code that runs every animation is not in the first
 *  download of every page. */
export { domAnimation as default } from "framer-motion";
