import React from "react";
import { Composition } from "remotion";
import { BannerVideo, type BannerProps } from "./BannerVideo";

const BannerVideoComp: React.FC<Record<string, unknown>> = (props) => {
  return <BannerVideo {...(props as unknown as BannerProps)} />;
};

const FPS = 30;

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="BannerVideo"
        component={BannerVideoComp}
        durationInFrames={FPS * 3}
        fps={FPS}
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
          durationInSeconds: 3,
        }}
        calculateMetadata={async ({ props }) => {
          const dur = (props as unknown as BannerProps).durationInSeconds ?? 3;
          const clamped = Math.min(10, Math.max(3, dur));
          return { durationInFrames: FPS * clamped };
        }}
      />
    </>
  );
};
