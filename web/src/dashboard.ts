// The dashboard (App and everything it draws) is a chunk of its own, loaded
// when the visitor goes there: the home, a visitor's first page on a phone,
// doesn't download it. Link starts loading it as soon as a finger or a pointer
// nears the way in, so that the click finds it ready.
export const loadDashboard = () => import("./App");
