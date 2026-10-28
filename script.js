'use strict';

const API_BASE_URL = 'https://thecspeedcell-site.onrender.com/api';
const WHATSAPP_URL = 'https://wa.me/5511996073752';
const statuses = ['Recebido', 'Em análise', 'Aguardando aprovação', 'Em andamento', 'Concluído', 'Cancelado'];
const $ = selector => document.querySelector(selector);
const nav = $('#nav');
let adminToken = '';
let adminRequests = [];

$('#menuBtn').addEventListener('click', () => {
  const opened = nav.classList.toggle('open');
  $('#menuBtn').setAttribute('aria-expanded', String(opened));
});
nav.querySelectorAll('a').forEach(link => link.addEventListener('click', () => {
  nav.classList.remove('open');
  $('#menuBtn').setAttribute('aria-expanded', 'false');
}));
$('#year').textContent = new Date().getFullYear();

const whatsapp = $('#whatsappLink');
whatsapp.href = WHATSAPP_URL;
whatsapp.target = '_blank';
whatsapp.rel = 'noopener noreferrer';

function showMessage(target, lines) {
  target.replaceChildren(...lines.map(line => {
    const paragraph = document.createElement('p');
    paragraph.textContent = line;
    return paragraph;
  }));
}

function errorMessage(error) {
  if (error instanceof TypeError) {
    return 'Não foi possível conectar ao sistema de atendimento. Tente novamente em instantes.';
  }
  return error.message || 'Não foi possível concluir a operação.';
}

async function apiRequest(path, options = {}) {
  const response = await fetch(`${API_BASE_URL}${path}`, options);
  let result;
  try {
    result = await response.json();
  } catch {
    throw new Error('O sistema de atendimento retornou uma resposta inválida.');
  }
  if (!response.ok) {
    const error = new Error(result.message || `Falha no atendimento (HTTP ${response.status}).`);
    error.status = response.status;
    throw error;
  }
  return result;
}

$('#quoteForm').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  if (!form.reportValidity()) return;

  const button = form.querySelector('button[type="submit"]');
  const result = $('#quoteResult');
  button.disabled = true;
  button.textContent = 'Enviando solicitação...';
  result.replaceChildren();

  const data = Object.fromEntries(new FormData(form));
  try {
    const created = await apiRequest('/solicitacoes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nome: data.nome.trim(),
        telefone: data.telefone.trim(),
        email: (data.email || '').trim(),
        servico: data.servico,
        equipamento: data.equipamento.trim(),
        descricao: data.descricao.trim(),
      }),
    });
    if (typeof created.id !== 'string' || !created.id) {
      throw new Error('O sistema não confirmou o protocolo da solicitação.');
    }
    showMessage(result, [
      `Solicitação registrada. Protocolo: ${created.id}`,
      'Guarde este protocolo para acompanhar o atendimento.',
    ]);
    form.reset();
  } catch (error) {
    showMessage(result, [errorMessage(error)]);
  } finally {
    button.disabled = false;
    button.textContent = 'Registrar solicitação →';
  }
});

$('#trackForm').addEventListener('submit', async event => {
  event.preventDefault();
  const id = $('#protocol').value.trim().toUpperCase();
  const result = $('#trackResult');
  const button = event.currentTarget.querySelector('button');
  button.disabled = true;
  result.replaceChildren();
  try {
    const request = await apiRequest(`/solicitacoes/${encodeURIComponent(id)}`);
    const createdAt = new Date(request.criadoEm);
    showMessage(result, [
      `Protocolo: ${request.id}`,
      `Serviço: ${request.servico}`,
      `Status: ${request.status}`,
      `Criado em: ${Number.isNaN(createdAt.valueOf()) ? 'Data indisponível' : createdAt.toLocaleString('pt-BR')}`,
    ]);
  } catch (error) {
    showMessage(result, [errorMessage(error)]);
  } finally {
    button.disabled = false;
  }
});

const adminForm = $('#adminLoginForm');
const adminTokenInput = $('#adminToken');
const adminMessage = $('#adminMessage');
const adminList = $('#adminList');
const adminLogout = $('#adminLogout');
const exportButton = $('#exportBtn');

function clearAdminSession(message = '') {
  adminToken = '';
  adminRequests = [];
  adminList.replaceChildren();
  adminForm.hidden = false;
  adminLogout.hidden = true;
  exportButton.hidden = true;
  if (message) showMessage(adminMessage, [message]);
}

function authHeaders() {
  return { Authorization: `Bearer ${adminToken}` };
}

function expireAdminSession(error) {
  if (error.status === 401) {
    clearAdminSession('Acesso expirado ou token inválido. Entre novamente.');
    return true;
  }
  return false;
}

function renderAdminRequests() {
  adminList.replaceChildren();
  if (!adminRequests.length) {
    showMessage(adminList, ['Nenhuma solicitação registrada.']);
    return;
  }

  adminRequests.forEach(request => {
    const card = document.createElement('article');
    card.className = 'request';
    const title = document.createElement('strong');
    title.textContent = request.id;
    card.append(title);
    [
      `${request.nome} • ${request.telefone} • ${request.servico}`,
      `E-mail: ${request.email || 'Não informado'}`,
      `Equipamento: ${request.equipamento}`,
      `Descrição: ${request.descricao}`,
      `Criado em: ${new Date(request.criadoEm).toLocaleString('pt-BR')}`,
    ].forEach(line => {
      const paragraph = document.createElement('p');
      paragraph.textContent = line;
      card.append(paragraph);
    });

    const select = document.createElement('select');
    select.setAttribute('aria-label', `Status do protocolo ${request.id}`);
    statuses.forEach(status => {
      const option = document.createElement('option');
      option.value = status;
      option.textContent = status;
      select.append(option);
    });
    select.value = request.status;
    select.addEventListener('change', async () => {
      const previousStatus = request.status;
      select.disabled = true;
      try {
        await apiRequest(`/admin/solicitacoes/${encodeURIComponent(request.id)}`, {
          method: 'PATCH',
          headers: { ...authHeaders(), 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: select.value }),
        });
        request.status = select.value;
      } catch (error) {
        select.value = previousStatus;
        if (!expireAdminSession(error)) showMessage(adminMessage, [errorMessage(error)]);
      } finally {
        select.disabled = false;
      }
    });
    card.append(select);
    adminList.append(card);
  });
}

adminForm.addEventListener('submit', async event => {
  event.preventDefault();
  if (!adminForm.reportValidity()) return;
  const submitButton = adminForm.querySelector('button[type="submit"]');
  const enteredToken = adminTokenInput.value;
  submitButton.disabled = true;
  adminMessage.replaceChildren();

  try {
    const requests = await apiRequest('/admin/solicitacoes', {
      headers: { Authorization: `Bearer ${enteredToken}` },
    });
    if (!Array.isArray(requests)) throw new Error('O sistema retornou uma lista inválida.');
    adminToken = enteredToken;
    adminRequests = requests;
    adminTokenInput.value = '';
    adminForm.hidden = true;
    adminLogout.hidden = false;
    exportButton.hidden = false;
    renderAdminRequests();
  } catch (error) {
    showMessage(adminMessage, [errorMessage(error)]);
  } finally {
    submitButton.disabled = false;
  }
});

adminLogout.addEventListener('click', () => clearAdminSession('Sessão encerrada.'));

exportButton.addEventListener('click', () => {
  const fields = ['id', 'nome', 'telefone', 'email', 'servico', 'equipamento', 'descricao', 'status', 'criadoEm'];
  const csv = [
    fields.join(';'),
    ...adminRequests.map(request => fields.map(field => {
      const value = String(request[field] || '').replace(/^[=+@\-\t\r]/, '\'$&').replace(/"/g, '""');
      return `"${value}"`;
    }).join(';')),
  ].join('\r\n');
  const url = URL.createObjectURL(new Blob(['\ufeff', csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'thecspeedcell-solicitacoes.csv';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
