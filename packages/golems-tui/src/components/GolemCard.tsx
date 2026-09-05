import React from "react";
import { Box, Text } from "ink";
import type { GolemInfo } from "../types.js";

const statusColors: Record<GolemInfo["status"], string> = {
  running: "green",
  stopped: "gray",
  error: "red",
  unknown: "yellow",
};

const statusIcons: Record<GolemInfo["status"], string> = {
  running: "✓",
  stopped: "○",
  error: "✗",
  unknown: "?",
};

interface GolemCardProps {
  golem: GolemInfo;
  selected: boolean;
  expanded: boolean;
}

export function GolemCard({ golem, selected, expanded }: GolemCardProps) {
  const color = statusColors[golem.status];
  const icon = statusIcons[golem.status];

  return (
    <Box flexDirection="column" marginBottom={expanded ? 1 : 0}>
      <Box>
        <Text color={selected ? "cyan" : undefined} bold={selected}>
          {selected ? "▸ " : "  "}
        </Text>
        <Text>{golem.emoji} </Text>
        <Text bold color={selected ? "cyan" : "white"}>
          {golem.name.padEnd(16)}
        </Text>
        <Text color={color}>
          {icon} {golem.detail}
        </Text>
      </Box>

      {expanded && (
        <Box flexDirection="column" marginLeft={4} marginTop={0}>
          <Text dimColor italic>
            {golem.description}
          </Text>
          <Box
            flexDirection="column"
            marginTop={1}
            borderStyle="single"
            borderColor="gray"
            paddingX={1}
          >
            {golem.trailerLines.map((line, i) => (
              <Text key={i} color={i === 0 ? "yellow" : "white"}>
                {line}
              </Text>
            ))}
          </Box>
        </Box>
      )}
    </Box>
  );
}
