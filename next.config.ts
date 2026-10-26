import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The reranker runs in-process on the server; keep the ONNX runtime, its native deps and pdfjs out of the bundle.
  serverExternalPackages: ["@huggingface/transformers", "onnxruntime-node", "sharp", "pdfjs-dist"],
};

export default nextConfig;
