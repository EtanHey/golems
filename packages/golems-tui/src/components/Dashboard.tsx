import React, { useState, useEffect, useCallback } from "react";
import { Box, Text, useInput, useApp } from "ink";
import { GolemCard } from "./GolemCard.js";
import { fetchGolemStatuses } from "../data.js";
import type { GolemInfo } from "../types.js";

const HEADER = `🜔 GOLEMS`;
const isTTY = Boolean(process.stdin.isTTY);

function KeyboardHandler({
  golems,
  selectedIndex,
  setSelectedIndex,
  expandedIndex,
  setExpandedIndex,
  refresh,
}: {
  golems: GolemInfo[];
  selectedIndex: number;
  setSelectedIndex: React.Dispatch<React.SetStateAction<number>>;
  expandedIndex: number | null;
  setExpandedIndex: React.Dispatch<React.SetStateAction<number | null>>;
  refresh: () => void;
}) {
  const { exit } = useApp();

  useInput((input, key) => {
    if (input === "q" || (key.ctrl && input === "c")) {
      exit();
      return;
    }
    if (key.upArrow || input === "k") {
      setSelectedIndex((i) => Math.max(0, i - 1));
    } else if (key.downArrow || input === "j") {
      setSelectedIndex((i) => Math.min(golems.length - 1, i + 1));
    } else if (key.return || input === " ") {
      setExpandedIndex((prev) => (prev === selectedIndex ? null : selectedIndex));
    } else if (input === "r") {
      refresh();
    }
  });

  return null;
}

export function Dashboard() {
  const [golems, setGolems] = useState<GolemInfo[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [time, setTime] = useState(() => new Date().toLocaleTimeString());

  const refresh = useCallback(async () => {
    setLoading(true);
    const statuses = await fetchGolemStatuses();
    setGolems(statuses);
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 10_000);
    return () => clearInterval(interval);
  }, [refresh]);

  useEffect(() => {
    const interval = setInterval(() => {
      setTime(new Date().toLocaleTimeString());
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const runningCount = golems.filter((g) => g.status === "running").length;

  return (
    <Box flexDirection="column" padding={1}>
      {isTTY && (
        <KeyboardHandler
          golems={golems}
          selectedIndex={selectedIndex}
          setSelectedIndex={setSelectedIndex}
          expandedIndex={expandedIndex}
          setExpandedIndex={setExpandedIndex}
          refresh={refresh}
        />
      )}

      {/* Header */}
      <Box justifyContent="space-between">
        <Text bold color="yellow">
          {HEADER}
        </Text>
        <Text dimColor>{time}</Text>
      </Box>

      <Box marginBottom={1}>
        <Text dimColor>
          {loading
            ? "Fetching status..."
            : `${runningCount}/${golems.length} active`}
        </Text>
      </Box>

      {/* Golem list */}
      {golems.map((golem, i) => (
        <GolemCard
          key={golem.name}
          golem={golem}
          selected={i === selectedIndex}
          expanded={i === expandedIndex}
        />
      ))}

      {/* Footer */}
      <Box marginTop={1}>
        <Text dimColor>
          ↑↓ navigate  ⏎ expand  r refresh  q quit
        </Text>
      </Box>
    </Box>
  );
}
