import { useMemo, useState } from 'react';

import RobotOutlined from '@ant-design/icons/RobotOutlined';
import PlusOutlined from '@ant-design/icons/PlusOutlined';
import SearchOutlined from '@ant-design/icons/SearchOutlined';
import SendOutlined from '@ant-design/icons/SendOutlined';
import CodeOutlined from '@ant-design/icons/CodeOutlined';
import FileTextOutlined from '@ant-design/icons/FileTextOutlined';
import BugOutlined from '@ant-design/icons/BugOutlined';
import { useTheme } from '@mui/material/styles';
import Avatar from '@mui/material/Avatar';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardActionArea from '@mui/material/CardActionArea';
import CardContent from '@mui/material/CardContent';
import Divider from '@mui/material/Divider';
import Grid from '@mui/material/Grid';
import InputAdornment from '@mui/material/InputAdornment';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemText from '@mui/material/ListItemText';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';

import MainCard from 'components/MainCard';

const seedConversations = [
  { id: 'fieldmind-1', title: 'How can I improve crop vigor?', preview: 'Need a starter recommendation for early-season stress.' },
  { id: 'fieldmind-2', title: 'What is variable-rate seeding?', preview: 'Give me a simple explanation and when to use it.' },
  { id: 'fieldmind-3', title: 'How should I adjust irrigation?', preview: 'Share guidance for the next 10 days by growth stage.' },
  { id: 'fieldmind-4', title: 'Can you summarize field notes?', preview: 'Turn my scouting notes into actions for this week.' }
];

function buildMockResponse(prompt) {
  return `Based on your prompt, FieldMind would analyze field history, current conditions, and management goals before recommending next steps.\n\nMock response: "${prompt}"\n\nSuggested workflow:\n1. Validate data inputs (location, season, and nutrient history).\n2. Segment by field zones and expected stress risk.\n3. Compare management options and select the lowest-risk action for this week.`;
}

export default function FieldMindDefault() {
  const theme = useTheme();
  const topPanelHeight = 156;
  const [conversations, setConversations] = useState(seedConversations);
  const [activeConversationId, setActiveConversationId] = useState(seedConversations[0].id);
  const [searchValue, setSearchValue] = useState('');
  const [promptValue, setPromptValue] = useState('');
  const [isResponding, setIsResponding] = useState(false);
  const [messagesByConversation, setMessagesByConversation] = useState(() =>
    seedConversations.reduce((accumulator, conversation) => {
      accumulator[conversation.id] = [
        {
          id: `${conversation.id}-welcome`,
          role: 'assistant',
          content: 'Hi, I am FieldMind. Ask me about crop performance, trait behavior, and field-level decisions.'
        }
      ];
      return accumulator;
    }, {})
  );

  const quickActions = useMemo(
    () => [
      {
        title: 'Write clean agronomy code snippets',
        subtitle: 'Generate efficient and readable scripts',
        icon: <CodeOutlined style={{ fontSize: 20 }} />,
        iconColor: 'primary.main',
        iconBg: 'primary.lighter',
        prompt: 'Create a Python snippet to flag low-performing field zones from NDVI and soil data.'
      },
      {
        title: 'Draft a grower update message',
        subtitle: 'Professional and concise summary',
        icon: <FileTextOutlined style={{ fontSize: 20 }} />,
        iconColor: 'warning.main',
        iconBg: 'warning.lighter',
        prompt: 'Write a concise grower update summarizing nutrient status and irrigation plan for this week.'
      },
      {
        title: 'Debug a data pipeline issue',
        subtitle: 'Troubleshoot quickly with clear steps',
        icon: <BugOutlined style={{ fontSize: 20 }} />,
        iconColor: 'error.main',
        iconBg: 'error.lighter',
        prompt: 'Help debug why my field yield prediction pipeline fails when county data is missing.'
      }
    ],
    [theme.vars.palette.error.main, theme.vars.palette.primary.main, theme.vars.palette.warning.main]
  );

  const visibleConversations = useMemo(() => {
    const normalizedSearch = searchValue.trim().toLowerCase();
    if (!normalizedSearch) return conversations;

    return conversations.filter(
      (conversation) =>
        conversation.title.toLowerCase().includes(normalizedSearch) || conversation.preview.toLowerCase().includes(normalizedSearch)
    );
  }, [conversations, searchValue]);

  const activeConversation = useMemo(
    () => conversations.find((conversation) => conversation.id === activeConversationId),
    [activeConversationId, conversations]
  );

  const activeMessages = messagesByConversation[activeConversationId] || [];

  const updateConversationMeta = (conversationId, latestPrompt) => {
    setConversations((previousConversations) =>
      previousConversations.map((conversation) => {
        if (conversation.id !== conversationId) return conversation;

        const nextTitle =
          conversation.title === 'New Chat'
            ? latestPrompt.length > 42
              ? `${latestPrompt.slice(0, 42)}...`
              : latestPrompt
            : conversation.title;

        return {
          ...conversation,
          title: nextTitle,
          preview: latestPrompt
        };
      })
    );
  };

  const handleNewChat = () => {
    const newId = `fieldmind-${Date.now()}`;
    const newConversation = {
      id: newId,
      title: 'New Chat',
      preview: 'Start a new conversation with FieldMind.'
    };

    setConversations((previousConversations) => [newConversation, ...previousConversations]);
    setMessagesByConversation((previousState) => ({
      ...previousState,
      [newId]: [
        {
          id: `${newId}-welcome`,
          role: 'assistant',
          content: 'New chat ready. Share your field context, and I will walk through next best actions.'
        }
      ]
    }));
    setActiveConversationId(newId);
    setPromptValue('');
    setIsResponding(false);
  };

  const handleSend = (optionalPrompt) => {
    const nextPrompt = (optionalPrompt ?? promptValue).trim();
    if (!nextPrompt || isResponding) return;

    const conversationId = activeConversationId;
    const userMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: nextPrompt
    };

    setMessagesByConversation((previousState) => ({
      ...previousState,
      [conversationId]: [...(previousState[conversationId] || []), userMessage]
    }));
    updateConversationMeta(conversationId, nextPrompt);
    setPromptValue('');
    setIsResponding(true);

    setTimeout(() => {
      const assistantMessage = {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        content: buildMockResponse(nextPrompt)
      };

      setMessagesByConversation((previousState) => ({
        ...previousState,
        [conversationId]: [...(previousState[conversationId] || []), assistantMessage]
      }));
      setIsResponding(false);
    }, 700);
  };

  return (
    <Stack spacing={2.5}>
      <MainCard
        boxShadow
        border={false}
        content={false}
        sx={{
          bgcolor: 'rgb(17, 26, 34)',
          color: 'text.primary',
          border: '1px solid',
          borderColor: 'divider'
        }}
      >
        <Box sx={{ px: 3, py: 2.25, bgcolor: 'rgb(17, 26, 34)' }}>
          <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
            <Typography variant="h4" sx={{ color: 'inherit' }}>
              FieldMind
            </Typography>
            <Typography variant="subtitle2" sx={{ color: 'inherit', opacity: 0.9 }}>
              CoPilot / chat interface
            </Typography>
          </Stack>
        </Box>
      </MainCard>

      <MainCard content={false} boxShadow sx={{ bgcolor: 'rgb(17, 26, 34)' }}>
        <Grid container sx={{ minHeight: { xs: 760, md: 680 } }}>
          <Grid
            size={{ xs: 12, md: 4, lg: 3 }}
            sx={(theme) => ({
              backgroundColor: 'rgb(17, 26, 34)',
              borderRight: {
                xs: 'none',
                md: `1px solid ${theme.vars.palette.divider}`
              },
              borderBottom: {
                xs: `1px solid ${theme.vars.palette.divider}`,
                md: 'none'
              },
              display: 'flex',
              flexDirection: 'column',
              minHeight: { xs: 300, md: 'auto' }
            })}
          >
            <Box
              sx={{
                p: 2.5,
                bgcolor: 'rgb(17, 26, 34)',
                minHeight: { md: topPanelHeight },
                display: 'flex',
                alignItems: 'center'
              }}
            >
              <Stack spacing={2}>
                <Avatar
                  sx={{
                    width: 44,
                    height: 44,
                    bgcolor: 'primary.lighter',
                    color: 'primary.main'
                  }}
                >
                  <RobotOutlined />
                </Avatar>
                <TextField
                  size="small"
                  fullWidth
                  placeholder="Search chat"
                  value={searchValue}
                  onChange={(event) => setSearchValue(event.target.value)}
                  slotProps={{
                    input: {
                      startAdornment: (
                        <InputAdornment position="start">
                          <SearchOutlined />
                        </InputAdornment>
                      )
                    }
                  }}
                />
              </Stack>
            </Box>
            <Divider />
            <List
              disablePadding
              sx={{
                p: 1.5,
                pt: 1,
                flexGrow: 1,
                overflowY: 'auto',
                bgcolor: 'rgb(17, 26, 34)'
              }}
            >
              {visibleConversations.map((conversation) => (
                <ListItemButton
                  key={conversation.id}
                  selected={conversation.id === activeConversationId}
                  onClick={() => setActiveConversationId(conversation.id)}
                  sx={{
                    borderRadius: 1,
                    mb: 0.75,
                    alignItems: 'flex-start',
                    px: 1.5,
                    py: 1
                  }}
                >
                  <ListItemText
                    primary={conversation.title}
                    secondary={conversation.preview}
                    primaryTypographyProps={{
                      variant: 'subtitle1',
                      noWrap: true,
                      sx: { fontWeight: 600 }
                    }}
                    secondaryTypographyProps={{
                      variant: 'body2',
                      noWrap: true,
                      sx: { mt: 0.25, color: 'text.secondary' }
                    }}
                  />
                </ListItemButton>
              ))}
            </List>
            <Box sx={{ p: 2.5, pt: 1.5, bgcolor: 'rgb(17, 26, 34)' }}>
              <Button fullWidth variant="contained" startIcon={<PlusOutlined />} onClick={handleNewChat}>
                New Chat
              </Button>
            </Box>
          </Grid>

          <Grid
            size={{ xs: 12, md: 8, lg: 9 }}
            sx={(theme) => ({ display: 'flex', flexDirection: 'column', backgroundColor: theme.vars.palette.background.paper })}
          >
            <Box
              sx={{
                p: { xs: 2, md: 3 },
                borderBottom: 1,
                borderColor: 'divider',
                bgcolor: 'rgb(17, 26, 34)',
                minHeight: { md: topPanelHeight },
                display: 'flex',
                alignItems: 'center'
              }}
            >
              <Stack spacing={0.75}>
                <Typography variant="h2">
                  Hey{' '}
                  <Box component="span" sx={{ color: 'success.main' }}>
                    there!
                  </Box>
                </Typography>
                <Typography variant="h4" color="text.primary">
                  What would you like to explore today?
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Active conversation: {activeConversation?.title || 'FieldMind'}
                </Typography>
              </Stack>
            </Box>

            {activeMessages.length <= 1 ? (
              <Box sx={{ px: { xs: 2, md: 3 }, pt: 2 }}>
                <Grid container spacing={2}>
                  {quickActions.map((action) => (
                    <Grid key={action.title} size={{ xs: 12, sm: 6, lg: 4 }}>
                      <Card
                        variant="outlined"
                        sx={{
                          height: '100%',
                          boxShadow:
                            '0 0 0 1px rgba(49, 93, 125, 0.14), 0 0 8px rgba(50, 103, 142, 0.18), 0 0 14px rgba(199, 236, 240, 0.10)'
                        }}
                      >
                        <CardActionArea onClick={() => handleSend(action.prompt)} sx={{ height: '100%' }}>
                          <CardContent sx={{ p: 2.25 }}>
                            <Stack spacing={1.5}>
                              <Box
                                sx={{
                                  width: 48,
                                  height: 48,
                                  borderRadius: 2,
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  bgcolor: action.iconBg,
                                  color: action.iconColor
                                }}
                              >
                                {action.icon}
                              </Box>
                              <Typography variant="h5">{action.title}</Typography>
                              <Typography variant="body2" color="text.secondary">
                                {action.subtitle}
                              </Typography>
                            </Stack>
                          </CardContent>
                        </CardActionArea>
                      </Card>
                    </Grid>
                  ))}
                </Grid>
              </Box>
            ) : null}

            <Box
              sx={{
                flexGrow: 1,
                p: { xs: 2, md: 3 },
                pt: 2,
                overflowY: 'auto',
                minHeight: { xs: 280, md: 340 }
              }}
            >
              <Stack spacing={2}>
                {activeMessages.map((message) => (
                  <Stack
                    key={message.id}
                    direction={message.role === 'user' ? 'row-reverse' : 'row'}
                    spacing={1.25}
                    sx={{ alignItems: 'flex-start' }}
                  >
                    <Avatar
                      sx={{
                        width: 32,
                        height: 32,
                        bgcolor: message.role === 'user' ? 'primary.main' : 'success.main',
                        color: message.role === 'user' ? 'primary.contrastText' : 'common.white',
                        fontSize: '0.75rem'
                      }}
                    >
                      {message.role === 'user' ? 'You' : 'FM'}
                    </Avatar>
                    <Box
                      sx={{
                        maxWidth: { xs: '90%', md: '76%' },
                        px: 1.5,
                        py: 1.25,
                        borderRadius: 2,
                        bgcolor: 'background.paper',
                        color: 'text.primary',
                        border: 1,
                        borderColor: 'divider'
                      }}
                    >
                      <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
                        {message.content}
                      </Typography>
                    </Box>
                  </Stack>
                ))}
                {isResponding ? (
                  <Stack direction="row" spacing={1.25} sx={{ alignItems: 'center' }}>
                    <Avatar sx={{ width: 32, height: 32, bgcolor: 'success.main', color: 'common.white', fontSize: '0.75rem' }}>FM</Avatar>
                    <Typography variant="body2" color="text.secondary">
                      FieldMind is thinking...
                    </Typography>
                  </Stack>
                ) : null}
              </Stack>
            </Box>

            <Divider />
            <Box sx={{ p: { xs: 2, md: 2.5 } }}>
              <Stack direction="row" spacing={1.5}>
                <TextField
                  fullWidth
                  placeholder="Ask FieldMind anything..."
                  value={promptValue}
                  onChange={(event) => setPromptValue(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault();
                      handleSend();
                    }
                  }}
                />
                <Button
                  variant="contained"
                  onClick={() => handleSend()}
                  disabled={!promptValue.trim() || isResponding}
                  endIcon={<SendOutlined />}
                >
                  Send
                </Button>
              </Stack>
            </Box>
          </Grid>
        </Grid>
      </MainCard>
    </Stack>
  );
}
