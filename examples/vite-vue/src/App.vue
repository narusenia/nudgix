<script setup>
import PlanCard from './components/PlanCard.vue';

const plans = [
  { title: 'Starter', price: 'Free' },
  { title: 'Team', price: '$12 / month' },
  { title: 'Business', price: '$40 / month' },
];
</script>

<template>
  <main class="page">
    <h1 class="heading">Plans</h1>
    <section class="cards">
      <PlanCard v-for="plan in plans" :key="plan.title" :title="plan.title" :price="plan.price" />
    </section>
  </main>
</template>

<style scoped>
.page {
  max-width: 896px;
  margin: 0 auto;
  padding: var(--space-8);
}

.heading {
  font-size: var(--font-size-3xl);
  color: var(--color-brand);
}

.cards {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: var(--space-4);
  margin-top: var(--space-8);
}
</style>
