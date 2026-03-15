import React from "react";
import { Composition } from "remotion";
import { BannerVideo, type BannerProps } from "./BannerVideo";

const BannerVideoComp: React.FC<Record<string, unknown>> = (props) => {
  return <BannerVideo {...(props as unknown as BannerProps)} />;
};

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="BannerVideo"
        component={BannerVideoComp}
        durationInFrames={90}
        fps={30}
        width={1920}
        height={1080}
        defaultProps={{
          variant: "A",
          companyLogo: "SAMSUNG",
          seriesTag: "KNOWLEDGE SERIES",
          topic: "Intro to AI Agents",
          subtopic: "Environment Setup & First Run",
          episode: "EP 01",
          duration: "3:15",
          presenter: "Vishwa",
          presenterInitial: "V",
        }}
      />
    </>
  );
};
