import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "ApplyPack",
    short_name: "ApplyPack",
    description: "We find the jobs. We get you ready to apply.",
    start_url: "/",
    display: "standalone",
    background_color: "#f6f9ff",
    theme_color: "#030b20",
  };
}
