import { handleContactPost, handleContactOptions, type ContactEnv } from "../src/index";
export const onRequestPost = ({ request, env }: { request: Request; env: ContactEnv }) =>
  handleContactPost(request, env);
export const onRequestOptions = ({ request, env }: { request: Request; env: ContactEnv }) =>
  handleContactOptions(request, env);
