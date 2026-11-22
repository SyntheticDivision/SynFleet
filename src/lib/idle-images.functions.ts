import { createServerFn } from "@tanstack/react-start";
import { listIdleImageFiles } from "@/lib/idle-images";

export const listIdleImages = createServerFn({ method: "GET" }).handler(async () => listIdleImageFiles());
