'use client';

import { motion } from 'framer-motion';

type Props = {
  html: string;
  title: string;
};

export default function DocsReader({ html, title }: Props) {
  return (
    <motion.div
      className="doc-reader"
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.25, 0.4, 0.25, 1] }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
