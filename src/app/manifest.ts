import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "ApplyPack",
    short_name: "ApplyPack",
    description: "We find the jobs. We get you ready to apply.",
    start_url: "/",
    display: "standalone",
    background_color: "#fbfafc",
    theme_color: "#5637d7",
  };
}
