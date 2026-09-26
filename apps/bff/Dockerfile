# dist/lambda.js is a self-contained esbuild bundle (scripts/build-lambda.mjs);
# run `pnpm --filter @greed/bff build` before this image builds. Node 26
# everywhere, same base image as btfp.
FROM public.ecr.aws/lambda/nodejs:26-preview

COPY dist/lambda.js dist/lambda.js.map ${LAMBDA_TASK_ROOT}/

CMD ["lambda.handler"]
