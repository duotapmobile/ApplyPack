# syntax=docker/dockerfile:1.7@sha256:a57df69d0ea827fb7266491f2813635de6f17269be881f696fbfdf2d83dda33e
FROM golang:1.26.10-bookworm@sha256:88750ccdd0f2a77fcc00a14b1a48d6409bd8ddb5d7c2dd6ec0b4a2e916daf9d9 AS build
USER root
COPY infra/aws/roles-anywhere-helper/ /helper-build/
RUN bash /helper-build/build.sh prepare
RUN --network=none bash /helper-build/build.sh compile

FROM build AS test
USER 1000:1000
ENTRYPOINT ["/tests/helper-offline-test"]

FROM scratch AS artifact
COPY --from=build /out/ /
