<script setup lang="ts">
import { computed } from 'vue';
import { kpiLabel, scoreColor } from '../api';

const props = defineProps<{
  kpiKey: string;
  score: number;
  calls?: number;
  /** Highlight as weakest when true */
  flagged?: boolean;
  /** Show the score number */
  showScore?: boolean;
}>();

const label = computed(() => kpiLabel(props.kpiKey));
const fillColor = computed(() => scoreColor(props.score));
const fillScale = computed(() => Math.max(0, Math.min(100, props.score)) / 100);
</script>

<template>
  <div class="kpi-bar" :class="{ 'kpi-bar--flagged': flagged }">
    <div class="kpi-bar-header">
      <span class="kpi-bar-label">{{ label }}</span>
      <div class="kpi-bar-right">
        <span v-if="flagged" class="kpi-flag">Weakest</span>
        <span v-if="calls !== undefined" class="kpi-calls">{{ calls }} call{{ calls === 1 ? '' : 's' }}</span>
        <span v-if="showScore !== false" class="kpi-score" :style="{ color: fillColor }">{{ score }}</span>
      </div>
    </div>
    <div class="kpi-bar-track">
      <div class="kpi-bar-fill" :style="{ '--fill-scale': fillScale, background: fillColor }"></div>
    </div>
  </div>
</template>

<style scoped>
.kpi-bar { display: flex; flex-direction: column; gap: 5px; }
.kpi-bar--flagged .kpi-bar-label { font-weight: 600; }

.kpi-bar-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.kpi-bar-label {
  font-size: 12.5px;
  color: var(--text);
  white-space: nowrap;
}

.kpi-bar-right {
  display: flex;
  align-items: center;
  gap: 6px;
}

.kpi-score {
  font-size: 13px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  min-width: 24px;
  text-align: right;
}

.kpi-flag {
  font-size: 10.5px;
  font-weight: 600;
  padding: 1px 6px;
  border-radius: 999px;
  background: #fef2f2;
  color: #dc2626;
}

.kpi-calls {
  font-size: 11px;
  color: var(--muted);
}

.kpi-bar-track {
  height: 6px;
  border-radius: 999px;
  background: #eef0f3;
  overflow: hidden;
}
.kpi-bar-fill {
  height: 100%;
  width: 100%;
  transform-origin: left center;
  transform: scaleX(var(--fill-scale, 0));
  animation: kpi-grow 560ms var(--ease-out) both;
}
@keyframes kpi-grow { from { transform: scaleX(0); } }

@media (prefers-reduced-motion: reduce) {
  .kpi-bar-fill { animation: none; }
}
</style>
