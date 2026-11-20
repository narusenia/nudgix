<script setup>
defineProps({ title: String, price: String });
</script>

<template>
  <article class="card">
    <h2 class="title">{{ title }}</h2>
    <p class="price">{{ price }}</p>
  </article>
</template>

<style scoped>
.card {
  padding: var(--space-6);
  background: var(--color-surface);
  border-radius: var(--radius-xl);
  box-shadow: 0 1px 3px rgb(0 0 0 / 0.1);
}

.title {
  margin: 0;
  font-size: var(--font-size-lg);
}

.price {
  margin: var(--space-2) 0 0;
  font-size: var(--font-size-sm);
  color: var(--color-muted);
}
</style>
